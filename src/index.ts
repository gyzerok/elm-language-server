import * as LServer from 'vscode-languageserver';
import * as cp from 'child_process';
const elm = require('node-elm-compiler');

const connection = LServer.createConnection(
  new LServer.IPCMessageReader(process),
  new LServer.IPCMessageWriter(process),
);

const documents = new LServer.TextDocuments();
documents.listen(connection);

connection.onInitialize(() => {
  return {
    textDocumentSync: documents.syncKind,
    capabilities: {
      documentFormattingProvider: true,
    },
  };
});

connection.onDocumentFormatting(params => {
  const document = documents.get(params.textDocument.uri);
  const text = document.getText();

  const wholeDocument = LServer.Range.create(
    LServer.Position.create(0, 0),
    document.positionAt(text.length - 1),
  );

  return new Promise<string>((resolve, reject) => {
    const cmd = cp.exec('elm-format --stdin', (err, stdout) => {
      err ? reject(err) : resolve(stdout);
    });

    cmd.stdin.write(text);
    cmd.stdin.end();
  })
    .then(formattedText => {
      return [LServer.TextEdit.replace(wholeDocument, formattedText)];
    })
    .catch(err => {
      // if ((<string>err.message).indexOf('SYNTAX PROBLEM') >= 0) {
      //   return new LServer.ResponseError(
      //     LServer.ErrorCodes.ParseError,
      //     'Running elm-format failed. Check the file for syntax errors.',
      //   );
      // } else {
      //   return new LServer.ResponseError(
      //     LServer.ErrorCodes.InternalError,
      //     'Running elm-format failed. Install from ' +
      //       "https://github.com/avh4/elm-format and make sure it's on your path",
      //   );
      // }
      return [];
    });
});

connection.onDidSaveTextDocument(params => {
  elm
    .compileToString([params.textDocument.uri.slice(7)], { report: 'json' })
    .then(() => {
      connection.sendDiagnostics({
        uri: params.textDocument.uri,
        diagnostics: [],
      });
    })
    .catch((err: Error) => {
      const issues = JSON.parse(err.message.split('\n')[1]);
      const diagnostics = issues.map((issue: any) => {
        return {
          severity: LServer.DiagnosticSeverity.Error,
          message: issue.details,
          range: {
            start: {
              line: issue.region.start.line - 1,
              character: issue.region.start.column - 1,
            },
            end: {
              line: issue.region.end.line - 1,
              character: issue.region.end.column - 1,
            },
          },
        };
      });

      connection.sendDiagnostics({
        uri: params.textDocument.uri,
        diagnostics,
      });
    });
});

connection.listen();

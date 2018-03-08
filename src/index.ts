import * as LServer from 'vscode-languageserver';
import * as cp from 'child_process';
const Compiler = require('node-elm-compiler');

const connection = LServer.createConnection(
  new LServer.IPCMessageReader(process),
  new LServer.IPCMessageWriter(process),
);

const documents = new LServer.TextDocuments();
documents.listen(connection);
let rootUri: string;

connection.onInitialize(params => {
  if (!params.rootUri) {
    connection.dispose();
    throw 'fuck';
  }

  rootUri = params.rootUri;

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
  // Because it starts with "file://"
  const path = params.textDocument.uri.slice(7);

  Compiler.compileToString(path, { report: 'json' })
    .then(() => {
      connection.sendDiagnostics({
        uri: params.textDocument.uri,
        diagnostics: [],
      });
    })
    .catch((err: Error) => {
      const issues = JSON.parse(err.message.split('\n')[1]);
      const byFile = issues.reduce((acc: any, issue: any) => {
        if (acc[issue.file]) {
          acc[issue.file].push(issue);
        } else {
          acc[issue.file] = [issue];
        }

        return acc;
      }, {});

      Object.keys(byFile).forEach((relativePath: string) => {
        const diagnostics = byFile[relativePath].map((issue: any) => {
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
          uri: rootUri + '/' + relativePath,
          diagnostics,
        });
      });
    });
});

connection.listen();

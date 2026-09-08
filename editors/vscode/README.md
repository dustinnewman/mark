# Mark for VS Code

Syntax highlighting for `.mark` files. The grammar is generated from the compiler's own line
classifier and token regexes by `npm run grammar` at the repository root; edit
`scripts/build-grammar.ts`, not the JSON.

Install by packaging a VSIX and handing it to VS Code (a linked folder is not enough: VS Code only
loads extensions recorded in its own manifest):

```sh
npm run vsix
code --install-extension build/mark-lang-vscode-0.1.0.vsix
```

Reload the window afterwards. To iterate on the grammar, run `npm run grammar`, repeat the two
commands above, then reload.

#!/bin/bash
# fetch latest version of openrelik-extension.vsix
curl -s https://api.github.com/repos/daschwanden/openrelik-ext/releases/latest | grep 'browser_download_url.*vsix' | cut -d : -f 2,3 | tr -d \" | wget -qi - 

# install extension with workaround for code
# https://github.com/microsoft/vscode-remote-release/issues/8535
export code="$(ls ~/.vscode-server*/bin/*/bin/code-server* | head -n 1)"
$code --install-extension openrelik-extension.vsix
rm openrelik-extension.vsix
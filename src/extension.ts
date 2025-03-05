// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

let openRelikStatus: 'running' | 'stopped' | 'unknown' = 'stopped';

let workerTerminals: vscode.Terminal[] = [];

function getTerminal(name: string): vscode.Terminal | undefined {
    const terminals = vscode.window.terminals;
    for (const terminal of terminals) {
      if (terminal.name === name) {
        return terminal;
      }
    }
    return undefined;
}

function getWorkspaceRootPath(): string | undefined {
	return (vscode.workspace.workspaceFolders && (vscode.workspace.workspaceFolders.length > 0))
	? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
}

function stopComposeWatch() {
    var terminal = getTerminal("Worker");
    if (terminal) {
        terminal.dispose();
    }
}

async function checkHealth(url: string, timeout: number = 5000): Promise<boolean> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, { signal: controller.signal });

        clearTimeout(timeoutId);

        if (response.ok) { // Check for 2xx status codes
            openRelikStatus = 'running';
            return true;
        } else {
            openRelikStatus = 'unknown';
            return false;
        }
    } catch (error: any) {
        if (error.name === 'AbortError') {
            console.log(`Health check timed out for ${url}`);
        } else if (error.code === 'ECONNREFUSED') {
            console.log(`Connection refused for ${url}. Server might not be running.`);
        } else {
            console.log(`Health check error for ${url}: ${error.message}`);
        }
        openRelikStatus = 'unknown';
        return false;
    }
}

async function waitForOpenRelik(url: string, maxRetries: number = 100, retryInterval: number = 5000): Promise<boolean> {
    let retryCount = 0;

    while (retryCount < maxRetries) {
        const isHealthy = await checkHealth(url);

        if (isHealthy) {
            vscode.window.showInformationMessage(`OpenRelik at ${url} is now available!`);
            return true;
        }

        retryCount++;
        console.log(`Retrying health check for ${url}... (Attempt ${retryCount}/${maxRetries})`);

        // Display a status bar message
        vscode.window.setStatusBarMessage(`Waiting for server at ${url}... (${retryCount}/${maxRetries})`, retryInterval);

        await new Promise(resolve => setTimeout(resolve, retryInterval)); // Wait before retrying
    }

    vscode.window.showErrorMessage(`OpenRelik at ${url} did not become available after ${maxRetries} attempts.`);
    return false;
}

export function activate(context: vscode.ExtensionContext) {
	const rootPath = (vscode.workspace.workspaceFolders && (vscode.workspace.workspaceFolders.length > 0))
	? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;

	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

	const updateStatusBar = async (workspacePath: string | undefined) => {
		if (!workspacePath) {
			statusBarItem.hide();
			return;
		}

		if (openRelikStatus === 'running') {
			statusBarItem.text = '$(debug-stop) Stop OpenRelik';
			statusBarItem.command = 'openrelik.stop';
			statusBarItem.show();
		} else if (openRelikStatus === 'stopped') {
			statusBarItem.text = '$(run) Start OpenRelik';
			statusBarItem.command = 'openrelik.start';
			statusBarItem.show();
		} else if (openRelikStatus === 'unknown') {
			statusBarItem.text = 'Waiting for OpenRelik...';
			statusBarItem.command = '';
			statusBarItem.show();
		} else {
			statusBarItem.hide();
		}
	};

	class OpenRelikProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
		constructor(private workspaceRoot: string | undefined) {}

		private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
        readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

        refresh(): void {
            this._onDidChangeTreeData.fire();
        }

        getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
            return element;
        }

		async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
            if (!this.workspaceRoot) {
                return [];
            }

			if (openRelikStatus === 'running') {
                const stopItem = new vscode.TreeItem('Stop OpenRelik', vscode.TreeItemCollapsibleState.None);
                stopItem.command = { command: 'openrelik.stop', title: 'Stop OpenRelik' };
                stopItem.iconPath = new vscode.ThemeIcon('debug-stop');
                const workerItem = new vscode.TreeItem('Create new worker', vscode.TreeItemCollapsibleState.None);
                workerItem.command = { command: 'openrelik.newWorker', title: 'New Worker' };
                workerItem.iconPath = new vscode.ThemeIcon('server-process');
                return [stopItem, workerItem];
            } else if (openRelikStatus === 'unknown') {
                const waitItem = new vscode.TreeItem('Waiting for OpenRelik', vscode.TreeItemCollapsibleState.None);
                waitItem.command = { command: '', title: 'Waiting for OpenRelik...' };
                waitItem.iconPath = new vscode.ThemeIcon('clock');
                return [waitItem];
            } else {
                const startItem = new vscode.TreeItem('Start OpenRelik', vscode.TreeItemCollapsibleState.None);
                startItem.command = { command: 'openrelik.start', title: 'Start OpenRelik' };
                startItem.iconPath = new vscode.ThemeIcon('run');
                return [startItem];
            }
        }
    }

	const openRelikProvider = new OpenRelikProvider(getWorkspaceRootPath());
    vscode.window.registerTreeDataProvider('openrelik', openRelikProvider);

	let startOpenRelik = vscode.commands.registerCommand('openrelik.start', async () => {
        const fs = require('fs');
		const workspacePath = getWorkspaceRootPath();
        const openRelikPath = `${workspacePath}/openrelik`;

		if (workspacePath) {
            vscode.window.showInformationMessage(`Workspace root: ${workspacePath}`);
        } else {
            vscode.window.showWarningMessage('No workspace folder is open.');
			return;
        }
        try {
            const terminal = vscode.window.createTerminal("OpenRelik");
            terminal.show();
			if (fs.existsSync(openRelikPath)) {
				terminal.sendText(`cd ${openRelikPath} && docker compose up -d`);
            } else {
                terminal.sendText(`cd ${workspacePath} && curl -s -O https://raw.githubusercontent.com/openrelik/openrelik-deploy/main/docker/install.sh && bash install.sh && cp openrelik/docker-compose.yml openrelik/docker-compose.yml.orig`);
            }
            vscode.window.showInformationMessage('Starting OpenRelik...');
            openRelikStatus = 'unknown';
            updateStatusBar(workspacePath);
            openRelikProvider.refresh();
            await waitForOpenRelik("http://localhost:8711");
            updateStatusBar(workspacePath);
            openRelikProvider.refresh();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error starting OpenRelik: ${error.message}`);
        }
    });

	let stopOpenRelik = vscode.commands.registerCommand('openrelik.stop', async () => {
        const workspacePath = getWorkspaceRootPath();

        try {
            var terminal = getTerminal("OpenRelik");
            if (! terminal) {
                terminal = vscode.window.createTerminal("Stop OpenRelik");
            }
            terminal.show();
            terminal.sendText(`cd ${workspacePath}/openrelik && docker compose down && exit`);
            vscode.window.showInformationMessage('Stopping OpenRelik...');
            openRelikStatus = 'stopped';
            updateStatusBar(workspacePath);
            openRelikProvider.refresh();
            for (const term of workerTerminals) {
                term.dispose();
            }
            stopComposeWatch();
            workerTerminals = [];
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error stopping OpenRelik: ${error.message}`);
        }
    });

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "openrelik" is now active!');

    let newWorker = vscode.commands.registerCommand('openrelik.newWorker', async () => {
        const workspacePath = getWorkspaceRootPath();
        const openRelikPath = `${workspacePath}/openrelik`;
        const scriptNewWorkerPath = path.join(__dirname, '..', 'scripts', 'newWorker.sh');
        const scriptUpdateComposePath = path.join(__dirname, '..', 'scripts', 'updateCompose.sh');
        const composeInclude = path.join(__dirname, '..', 'scripts', 'compose-include.yml');

		if (openRelikStatus === 'running' && openRelikPath) {
            try {
                // Use showInputBox to get user input
                const userInput = await vscode.window.showInputBox({
                    prompt: 'Please enter your input:',
                    placeHolder: 'Type here...'
                });
                if (userInput) {
                    console.log("User input:", userInput);
                    for (const term of workerTerminals) {
                        term.dispose();
                    }
                    workerTerminals = [];

                    fs.access(scriptNewWorkerPath, fs.constants.F_OK, (err) => {
                        if (err) {
                          console.error(`Script not found: ${scriptNewWorkerPath}`);
                          vscode.window.showErrorMessage('Script not found. Please check your extension installation.');
                          return; // Stop execution if the script is missing
                        }
                        const terminal = vscode.window.createTerminal(`Worker`);
                        terminal.show();
                        workerTerminals.push(terminal);
                        // Read the script content asynchronously
                        fs.promises.readFile(scriptNewWorkerPath, 'utf8')
                          .then(scriptNewWorkerContent => {
                            // Example: Add a shebang if it's missing (good practice)
                            if (!scriptNewWorkerContent.startsWith("#!/")) {
                                scriptNewWorkerContent = "#!/bin/bash\n" + scriptNewWorkerContent; // Add it
                            }
                            const command = `export WORKER=${userInput} && ${scriptNewWorkerContent} && sed "s/WORKER_NAME_HERE/$WORKER/g" ${composeInclude} > $WORKER/compose-include.yml && cd ${workspacePath}/openrelik && bash ${scriptUpdateComposePath} && docker compose watch`;
                            terminal.sendText(command);
                            vscode.window.showInformationMessage('Created new worker!');
                          })
                          .catch(err => {
                            console.error(`Error reading script: ${err}`);
                            vscode.window.showErrorMessage('Error reading script file.');
                          });
                    });
                } else {
                    // User cancelled the input
                    vscode.window.showInformationMessage("Input cancelled.");
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`Error creating new worker: ${error.message}`);
            }
        } else {
            vscode.window.showErrorMessage('OpenRelik must be running to create new worker');
        }
	});

    let newWorker1 = vscode.commands.registerCommand('openrelik.newWorker1', () => {
        const scriptPath = path.join(__dirname, '..', 'scripts', 'newWorker.sh');
    
        // Check if the script exists (important!)
        fs.access(scriptPath, fs.constants.F_OK, (err) => {
          if (err) {
            console.error(`Script not found: ${scriptPath}`);
            vscode.window.showErrorMessage('Script not found. Please check your extension installation.');
            return; // Stop execution if the script is missing
          }
    
          // Read the script content asynchronously
          fs.promises.readFile(scriptPath, 'utf8')
            .then(scriptContent => {
              const terminal = vscode.window.activeTerminal;
              if (terminal) {
                 // Example: Add a shebang if it's missing (good practice)
                if (!scriptContent.startsWith("#!/")) {
                  scriptContent = "#!/bin/bash\n" + scriptContent; // Add it
                }
                terminal.sendText(scriptContent);
              } else {
                vscode.window.showInformationMessage('No active terminal found. Please open a terminal.');
              }
            })
            .catch(err => {
              console.error(`Error reading script: ${err}`);
              vscode.window.showErrorMessage('Error reading script file.');
            });
        });
      });
    
      context.subscriptions.push(startOpenRelik);
      context.subscriptions.push(stopOpenRelik);
      context.subscriptions.push(newWorker);
}

// This method is called when your extension is deactivated
export function deactivate() {}

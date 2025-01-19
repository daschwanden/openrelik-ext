// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as childProcess from 'child_process';
import * as readline from 'readline';
import("node-fetch");

let dockerComposeStatus: 'running' | 'stopped' | 'unknown' = 'stopped';

async function checkHealth(url: string, timeout: number = 5000): Promise<boolean> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, { signal: controller.signal });

        clearTimeout(timeoutId);

        if (response.ok) { // Check for 2xx status codes
            dockerComposeStatus = 'running';
            return true;
        } else {
            dockerComposeStatus = 'unknown';
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
        dockerComposeStatus = 'unknown';
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

function getWorkspaceRoot(): string | undefined {
    if (!vscode.workspace.workspaceFolders) {
        // No workspace folders open
        return undefined;
    }

    // VS Code supports multi-root workspaces.
    // For single-root workspaces, this will still work correctly.
    const workspaceFolder = vscode.workspace.workspaceFolders[0];

    return workspaceFolder.uri.fsPath;
}

// This method is called when the extension is activated
// The extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

    const updateStatusBar = async (workspacePath: string) => {
        if (!workspacePath) {
            statusBarItem.hide();
            return;
        }

        if (dockerComposeStatus === 'running') {
            statusBarItem.text = '$(debug-stop) Stop OpenRelik';
            statusBarItem.command = 'openrelik.stopOpenRelik';
            statusBarItem.show();
        } else if (dockerComposeStatus === 'stopped') {
            statusBarItem.text = '$(run) Start OpenRelik';
            statusBarItem.command = 'openrelik.startOpenRelik';
            statusBarItem.show();
        } else if (dockerComposeStatus === 'unknown') {
            statusBarItem.text = 'Waiting for OpenRelik...';
            statusBarItem.command = '';
            statusBarItem.show();
        } else {
            statusBarItem.hide();
        }
    };

	class DockerComposeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
        private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
        readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

        refresh(): void {
            this._onDidChangeTreeData.fire();
        }

        getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
            return element;
        }

        async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                return [];
            }
            const workspacePath = workspaceFolders[0].uri.fsPath;

            if (dockerComposeStatus === 'running') {
                const stopItem = new vscode.TreeItem('Stop OpenRelik', vscode.TreeItemCollapsibleState.None);
                stopItem.command = { command: 'openrelik.stopOpenRelik', title: 'Stop OpenRelik' };
                stopItem.iconPath = new vscode.ThemeIcon('debug-stop');
                return [stopItem];
            } else if (dockerComposeStatus === 'unknown') {
                const waitItem = new vscode.TreeItem('Waiting for OpenRelik', vscode.TreeItemCollapsibleState.None);
                waitItem.command = { command: '', title: 'Waiting for OpenRelik...' };
                waitItem.iconPath = new vscode.ThemeIcon('clock');
                return [waitItem];
            } else {
                const startItem = new vscode.TreeItem('Start OpenRelik', vscode.TreeItemCollapsibleState.None);
                startItem.command = { command: 'openrelik.startOpenRelik', title: 'Start OpenRelik' };
                startItem.iconPath = new vscode.ThemeIcon('run');
                return [startItem];
            }
        }
    }

	const dockerComposeProvider = new DockerComposeProvider();
    vscode.window.registerTreeDataProvider('openrelik', dockerComposeProvider);

    let startOpenRelik = vscode.commands.registerCommand('openrelik.startOpenRelik', async () => {
        const fs = require('fs');
		const workspacePath = getWorkspaceRoot();

        const devPath = `${workspacePath}/openrelik-dev`;
        const startScript = `${devPath}/poststart.sh`;

		if (workspacePath) {
            vscode.window.showInformationMessage(`Workspace root: ${workspacePath}`);
        } else {
            vscode.window.showWarningMessage('No workspace folder is open.');
			return;
        }
        try {
            const terminal = vscode.window.createTerminal("OpenRelik");
            terminal.show();
            if (!fs.existsSync(devPath)) {
                vscode.window.showWarningMessage('openrelik-dev folder not found, cloning the repo, then run start script.');
                terminal.sendText(`git clone https://github.com/daschwanden/openrelik-dev.git; cd ${devPath}; ${startScript}`);
            } else {
                vscode.window.showWarningMessage('openrelik-dev folder found, running start script.');
                terminal.sendText(`cd ${devPath}; ${startScript}`);
            }
            vscode.window.showInformationMessage('Starting OpenRelik...');
            dockerComposeStatus = 'unknown';
            updateStatusBar(workspacePath);
            dockerComposeProvider.refresh();
            await waitForOpenRelik("http://localhost:8711");
            updateStatusBar(workspacePath);
            dockerComposeProvider.refresh();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error starting OpenRelik: ${error.message}`);
        }
    });

	let stopOpenRelik = vscode.commands.registerCommand('openrelik.stopOpenRelik', async () => {
        const workspacePath = getWorkspaceRoot();
        const devPath = `${workspacePath}/openrelik-dev`;

		if (devPath) {
            vscode.window.showInformationMessage(`Workspace root: ${workspacePath}`);
        } else {
            vscode.window.showWarningMessage('No workspace folder is open.');
			return;
        }
        try {
            const terminal = vscode.window.createTerminal("Stop OpenRelik");
            terminal.show();
            terminal.sendText(`cd ${devPath}/openrelik; docker compose down`);
            vscode.window.showInformationMessage('Stopping OpenRelik...');
            dockerComposeStatus = 'stopped';
            updateStatusBar(devPath);
            dockerComposeProvider.refresh();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error stopping OpenRelik: ${error.message}`);
        }
    });

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('openrelik.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from OpenRelik!');
	});

	const newWorker = vscode.commands.registerCommand('openrelik.newWorker', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('New worker!');
	});

	context.subscriptions.push(disposable);
	context.subscriptions.push(newWorker);
	context.subscriptions.push(startOpenRelik);
    context.subscriptions.push(stopOpenRelik);
    context.subscriptions.push(statusBarItem);

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        updateStatusBar(workspaceFolders[0].uri.fsPath);
    }

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your OpenRelik extension is now active!');
}

// This method is called when your extension is deactivated
export function deactivate() {}
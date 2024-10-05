import * as vscode from 'vscode';
import * as os from 'os';

// Helper function to get the local IP address
function getLocalIpAddress(): string | undefined {
    const interfaces = os.networkInterfaces();
    for (const ifaceName in interfaces) {
        const iface = interfaces[ifaceName];
        if (iface) {
            for (const alias of iface) {
                if (alias.family === 'IPv4' && !alias.internal) {
                    return alias.address;  // Return LAN IP address
                }
            }
        }
    }
    return undefined;
}

// Server Control Provider class
export class ServerControlProvider implements vscode.TreeDataProvider<ServerControlItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ServerControlItem | undefined> = new vscode.EventEmitter<ServerControlItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<ServerControlItem | undefined> = this._onDidChangeTreeData.event;
    private serverIp: string;
    private serverPort: number;

    constructor() {
        this.serverIp = getLocalIpAddress() ?? 'Not Available';
        this.serverPort = 8080; // Default port
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: ServerControlItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ServerControlItem): ServerControlItem[] {
        const ipItem = new ServerControlItem(`IP Address: ${this.serverIp}`, vscode.TreeItemCollapsibleState.None);
        const portItem = new ServerControlItem(`Port: ${this.serverPort}`, vscode.TreeItemCollapsibleState.None);
        
        // Button to Start the Server
        const startButton = new ServerControlItem(`Click to Start Collab Server (LAN)`, vscode.TreeItemCollapsibleState.None, {
            command: 'vscode-collab.startServerWithLAN',
            title: 'Start Server'
        });
        
        // Button to Join an Existing Server
        const joinButton = new ServerControlItem(`Click to Join Collab Server`, vscode.TreeItemCollapsibleState.None, {
            command: 'vscode-collab.joinServer',
            title: 'Join Server'
        });

        return [ipItem, portItem, startButton, joinButton];
    }
}

export class ServerControlItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command
    ) {
        super(label, collapsibleState);
        if (command) {
            this.command = command;
        }
    }
}
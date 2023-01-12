// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import {User} from './class/user';
import {closeWS, cursorMoved, openWS, textReplaced} from './ws';

const users = new Map<string, User>();

let username = process.env.username;
let project = process.env.projectId;


export function activate(context: vscode.ExtensionContext) {
    console.log("init");

    if (!username) {
        username = "User";
    }
    if (!project) {
        project = "Test";
    }

    openWS(username, project);

    vscode.window.onDidChangeTextEditorSelection(() => { // wird aufgerufen, wenn cursorposition sich ändert
        let editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        let lineNumber = editor.selection.active.line;
        let position = editor.selection.active.character;
        let pathName = pathString(editor.document.fileName);
        let selectionLine = editor.selection.end.line;
        let selectionPosition = editor.selection.end.character;

        if (editor.selection.active === editor.selection.end) { // flippt wenn cursor ist am ende der Markierung
            selectionLine = editor.selection.start.line;
            selectionPosition = editor.selection.start.character;
        }
        //markLine(lineNumber,position,"Pascal");	// markiert aktuell den cursor und taggt "Pascal" | wird später für syncro benötigt
        cursorMoved(pathName, lineNumber, position, selectionLine, selectionPosition, "Pascal", "Test");
    });

    vscode.workspace.onDidChangeTextDocument(changes => { // wird aufgerufen, wenn der Text geändert wird | muss Sperre reinmachen, wenn andere tippen | timeout?
        let editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        for (let change of changes.contentChanges) {
            let pathName = pathString(editor.document.fileName);
            let fromLine = change.range.start.line;
            let fromPos = change.range.start.character;
            let content = jsonString(change.text);
            let toLine = change.range.end.line;
            let toPos = change.range.end.character;
            console.log(`Text replaced from ${fromLine + 1}:${fromPos} to ${toLine + 1}:${toPos}`);

            textReplaced(pathName, fromLine, fromPos, toLine, toPos, content, "Pascal", "Test");
        }
    });


    let disposable = vscode.commands.registerCommand('firstextention.testCommand', () => {
        vscode.window.showInformationMessage('Line: ' + vscode.window.activeTextEditor?.selection.active.line + " | Position: " + vscode.window.activeTextEditor?.selection.active.character);
    });

    context.subscriptions.push(disposable);
}

//function getUserName() {
//	return process.env.userName;
//}

//function getProjectId(){
//	return process.env.projectId;
//}

export function userJoined(name: string) {
    users.set(name, new User(name));
    vscode.window.setStatusBarMessage("User: " + name + " joined", 5000);
}

export function userLeft(name: string) {
    if (users.has(name)) {
        removeMarking(users.get(name));
        users.delete(name);
        vscode.window.setStatusBarMessage("User: " + name + " left", 5000);
    }
}

function removeMarking(user: User | undefined) {
    let editor = vscode.window.activeTextEditor;
    if (user && editor) {
        editor.setDecorations(user.getColorIndicator(), []);
        editor.setDecorations(user.getNameTag(), []);
        editor.setDecorations(user.getSelection(), []);
        editor.setDecorations(user.getCursor(), []);
    }
}

export function markLine(pathName: string, lineNumber: number, position: number, selectionLine: number, selectionPosition: number, name: string): void {
    console.log("markLine called");
    let editor = vscode.window.activeTextEditor;
    let user = users.get(name);
    if (!editor || relPath(editor.document.fileName) !== pathName || !user) {
        return;
    }
    let line = editor.document.lineAt(lineNumber);

    editor.setDecorations(user.getColorIndicator(), [line.range]);
    editor.setDecorations(user.getNameTag(), [line.range]);    // markiert ganze line damit NameTag am Ende ist

    console.log(selectionLine, selectionPosition);

    let selection = new vscode.Range(new vscode.Position(lineNumber, position), new vscode.Position(selectionLine, selectionPosition));
    editor.setDecorations(user.getSelection(), [selection]);   // markiert textauswahl in 66% crimson

    let currrentPosition = new vscode.Position(lineNumber, position);
    let markerPosition = {
        range: new vscode.Range(currrentPosition, currrentPosition),
    };
    editor.setDecorations(user.getCursor(), [markerPosition]); // markiert Cursorposition in crimson
}

export function replaceText(pathName: string, fromLine: number, fromPosition: number, toLine: number, toPosition: number, content: string, name: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || pathName !== relPath(editor.document.fileName) || !users.has(name)) {
        return;
    }
    const edit = new vscode.WorkspaceEdit();
    const from = new vscode.Position(fromLine, fromPosition);
    const to = new vscode.Position(toLine, toPosition);


    edit.replace(editor.document.uri, new vscode.Range(from, to), content);
    vscode.workspace.applyEdit(edit);
}

function jsonString(content: string) {
    return content.replace(/\\/g, '\\\\').replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function pathString(path: string) {
    path = relPath(path);
    return path.replace(/\\/g, '\\\\');
}

function relPath(path: string) {
    const projectRoot = vscode.workspace.workspaceFolders?.at(0)?.uri.fsPath;
    if (projectRoot) {
        path = path.replace(projectRoot, '');
    }
    return path;
}

export function deactivate() {
    return new Promise(() => {
        if (!username || !project) {
            return;
        }
        closeWS(username, project);
    });
}

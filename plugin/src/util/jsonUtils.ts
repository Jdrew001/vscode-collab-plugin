import * as vscode from 'vscode';
import { Position } from '../interface/position';

export function buildUserMessage(operation: string, userId: string, project: string, userName?: string, userDisplayName?: string) {
    return JSON.stringify({operation, data: {userId, project, userName, userDisplayName}});
}

export function buildCursorMovedMessage(operation: string, pathName: string, cursor: Position, selectionEnd: Position, userId: string, project: string) {
    return JSON.stringify({operation, data: {pathName, cursor, selectionEnd, userId, project}});
}

export function buildSendTextReplacedMessage(operation: string, pathName: string, from: Position, to: Position, content: string, userId: string, project: string) {
    return JSON.stringify({operation, data: {pathName, from, to, content, userId, project}});
}

export function buildChatMessage(operation: string, msg: string, userId: string, project: string) {
    return JSON.stringify({operation, data: {msg, userId, time: new Date(), project}});
}

export function buildSendTextDelKeyMessage(operation: string, pathName: string, from: Position, delLinesCounter: number, delCharCounter: number, userId: string, project: string) {
    return JSON.stringify({operation, data: {pathName, from, delLinesCounter, delCharCounter, userId, project}});
}

export function buildSendFileMessage(operation: string, pathName: string, content: string, userId: string, project: string) {
    return JSON.stringify({operation, data: {pathName, content, userId, project}});
}

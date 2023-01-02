export function buildUserMessage(operation:string,name:string,project:string){
    return `{"operation":"${operation}","data":{"name":"${name}","project":"${project}"}}`
}

export function buildCursorMovedMessage(pathName:string,lineNumber:any,position:any,name:string,project:string){
    return `{"operation":"cursorMoved","data":{"pathName":"${pathName}","lineNumber":"${lineNumber}",
            "position":"${position}","name":"${name}", "project":"${project}"}}`;
}

export function buildTextChangedMessage(pathName:string,lineNumber:any,content:string,name:string,project:string){
    return `{"operation":"textChanged","data":{"pathName":"${pathName}","lineNumber":"${lineNumber}",
    "content":"${content}","name":"${name}", "project":"${project}"}}`;
}
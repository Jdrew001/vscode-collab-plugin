export function stringToColor(name: string) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    // Hash-Wert auf 6 Hexadezimalstellen beschränken
    let color = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    color = "000000".substring(0, 6 - color.length) + color;
    return color;
}

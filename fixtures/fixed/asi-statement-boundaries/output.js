export function exposed(foo, f) {
    foo();
    [
        1
    ].forEach(f);
}
export function removed(foo, f) {
    foo();
    [
        2
    ].forEach(f);
}
export function elseDropped(foo, f) {
    foo();
    [
        3
    ].forEach(f);
}
export function elseSameLine(foo, f) {
    foo();
    f(4);
}
export function switchLeading(foo, f) {
    foo();
    [
        5
    ].forEach(f);
}
export function nestedIf(cond, f) {
    if (cond) f(10);
    f(11);
}
export function loopBody(items, f) {
    for (const item of items)f(item);
    f(12);
}
export function labeledBody(f) {
    block: f(13);
    f(14);
}
export function outerElse(cond, f) {
    if (cond) f(16);
    else f(17);
}
export function outerElseAfterBlock(cond, items, f) {
    if (cond) for (const item of items){
        f(item);
    }
    else f(18);
}

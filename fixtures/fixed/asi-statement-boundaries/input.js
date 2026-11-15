import { isBuildConditions, switchBuildCondition } from '@memebattle/build-conditions';

export function exposed(foo, f) {
    foo()
    if (isBuildConditions('desktop')) [1].forEach(f)
}

export function removed(foo, f) {
    foo()
    if (isBuildConditions('mobile')) {
        f(9)
    }
    [2].forEach(f)
}

export function elseDropped(foo, f) {
    if (isBuildConditions('desktop')) foo()
    else { f(0) } [3].forEach(f)
}

export function elseSameLine(foo, f) {
    if (isBuildConditions('desktop')) foo()
    else f(0); f(4)
}

export function switchLeading(foo, f) {
    foo()
    switchBuildCondition({ desktop: [5], mobile: [6] }).forEach(f)
}

export function nestedIf(cond, f) {
    if (cond) if (isBuildConditions('desktop')) f(10)
    else f(0); f(11)
}

export function loopBody(items, f) {
    for (const item of items) if (isBuildConditions('desktop')) f(item)
    else f(0); f(12)
}

export function labeledBody(f) {
    block: if (isBuildConditions('desktop')) f(13)
    else f(0); f(14)
}

export function outerElse(cond, f) {
    if (cond) if (isBuildConditions('desktop')) f(16)
    else f(0)
    else f(17)
}

export function outerElseAfterBlock(cond, items, f) {
    if (cond) if (isBuildConditions('desktop')) for (const item of items) { f(item) }
    else f(0)
    else f(18)
}

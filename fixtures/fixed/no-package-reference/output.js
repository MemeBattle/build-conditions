// Module without a reference to the package: the tree traversal is skipped
// (early exit) and the code stays untouched — including local functions
// that share names with the helpers
import { other } from './other';
function isBuildConditions(value) {
    return other(value);
}
export function main(arg) {
    if (isBuildConditions('desktop')) {
        return 1;
    }
    return 2;
}

import { isBuildConditions } from '@memebattle/build-conditions';
export function check(condition) {
    return isBuildConditions(condition);
}

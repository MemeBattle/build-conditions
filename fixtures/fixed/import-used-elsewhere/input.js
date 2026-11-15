import { isBuildConditions } from '@memebattle/build-conditions';
import { format } from './format';
export function run() {
    if (isBuildConditions('mobile')) {
        format('mobile');
    }
    return format('common');
}

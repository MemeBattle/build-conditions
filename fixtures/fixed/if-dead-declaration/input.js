import { isBuildConditions } from '@memebattle/build-conditions';
import { format } from './format';
const mobileFormat = value => format(value, 'mobile');
export function run(value) {
    if (isBuildConditions('mobile')) {
        return mobileFormat(value);
    }
    return value;
}

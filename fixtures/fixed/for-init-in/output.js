import { obj, Alpha, Beta, left, right } from './values';
for(let fn = ('a' in obj) ? Alpha : Beta; fn;)break;
let target;
for(target = ('a' in left);;)break;
for(const getter = ()=>('a' in right);;)break;
for(var arrow = ()=>('x' in obj); arrow;)break;
for(let safe = [
    'a' in obj
]; safe;)break;

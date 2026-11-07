import { switchBuildCondition } from '@memebattle/build-conditions';
import ServerLogger from './logger@server';
import clientLogger from './logger@client';
export const logger = switchBuildCondition({
    default: clientLogger,
    server: ServerLogger,
});

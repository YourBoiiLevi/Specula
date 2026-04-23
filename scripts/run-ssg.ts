import 'dotenv/config';
import { loadConfig } from '../config.js';
import { generate } from '../src/ssg/index.js';

const result = await generate(loadConfig());
console.log(JSON.stringify(result, null, 2));

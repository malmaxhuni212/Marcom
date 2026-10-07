// @ts-nocheck
import { zodToJsonSchema } from 'zod-to-json-schema';
import { StructuredBriefSchema } from '../marcom/schemas/structured-brief';
import * as fs from 'fs';
import * as path from 'path';

const schema = zodToJsonSchema(StructuredBriefSchema, "StructuredBrief");

const targetDir = path.join(process.cwd(), 'agents', 'brief-analyzer');
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

fs.writeFileSync(
  path.join(targetDir, 'schema.json'),
  JSON.stringify(schema, null, 2)
);

console.log('Successfully generated agents/brief-analyzer/schema.json');

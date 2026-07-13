import { createProject } from "../services/project.js";
import { parseArgs, requireArg } from "../utils/args.js";

const args = parseArgs();
const name = requireArg(args, "name");
const projectDir = createProject(name);

console.log(`Created project: ${projectDir}`);
console.log("Add your reference video as reference/reference.mp4");

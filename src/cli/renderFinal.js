import { loadEnv, rootDir } from "../config.js";
import { parseArgs, requireArg } from "../utils/args.js";
import { renderFinalVideo } from "../services/remotionRenderer.js";

loadEnv();

const args = parseArgs();
const project = requireArg(args, "project");
const port = Number(args.port || process.env.PORT || 4173);

const result = await renderFinalVideo({ project, port, cwd: rootDir });
console.log(JSON.stringify(result, null, 2));

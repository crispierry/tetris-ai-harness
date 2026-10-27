// Public offline launcher. Derive identity from this checkout without changing its index.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

export function localEnvironment({cwd=fileURLToPath(new URL('./',import.meta.url)),port='4407',env=process.env}={}) {
  if (!/^[1-9][0-9]{3,4}$/.test(String(port)) || Number(port)<1024 || Number(port)>65535) throw Error('PORT must be an integer from 1024 to 65535.');
  const gitEnv={...env};
  for (const key of Object.keys(gitEnv)) if (key.startsWith('GIT_')) delete gitEnv[key];
  const git=(args,extra={})=>execFileSync('git',['-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null',...args],{cwd,env:{...gitEnv,...extra},encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const temporary=mkdtempSync(path.join(os.tmpdir(),'tetris-index-'));
  try {
    const head=git(['rev-parse','--verify','HEAD']),index={GIT_INDEX_FILE:path.join(temporary,'index')};
    git(['read-tree','HEAD'],index);
    git(['--literal-pathspecs','add','-A','--','.'],index);
    const tree=git(['write-tree'],index);
    return {...env,BOB_LOCAL_URL:`http://127.0.0.1:${port}/`,BOB_LOCAL_PORT:String(port),BOB_LOCAL_HEAD:head,BOB_LOCAL_BASE:head,BOB_LOCAL_TREE:tree,BOB_LOCAL_OPERATION_ID:randomUUID()};
  } finally { rmSync(temporary,{recursive:true,force:true}); }
}

if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    Object.assign(process.env,localEnvironment({port:process.env.PORT??'4407'}));
    await import('./server.mjs');
    if (!process.exitCode) console.log(`Tetris: ${process.env.BOB_LOCAL_URL} (OpenAI is off unless explicitly enabled)`);
  } catch (error) {
    console.error(error.message?.startsWith('PORT must') ? error.message : 'Local startup failed. Use a Git clone with Git installed; check the port and explicit provider configuration.');
    process.exitCode=1;
  }
}

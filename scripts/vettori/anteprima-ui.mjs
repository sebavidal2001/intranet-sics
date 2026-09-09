import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
const cwd=process.cwd();const server=await createServer({root:path.join(cwd,'scripts/vettori/anteprima-ui'),plugins:[react()],resolve:{alias:{'@':path.join(cwd,'src')}},css:{postcss:cwd},server:{host:'127.0.0.1',port:4178,strictPort:true,fs:{allow:[cwd]}}});await server.listen();console.log('Anteprima UI http://127.0.0.1:4178');

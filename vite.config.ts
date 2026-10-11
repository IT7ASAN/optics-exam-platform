import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      {
        name: 'copy-static-dirs',
        closeBundle() {
          const dirsToCopy = ['data', 'files', 'assets'];
          for (const dir of dirsToCopy) {
            const src = path.resolve(__dirname, dir);
            const dest = path.resolve(__dirname, 'dist', dir);
            if (fs.existsSync(src)) {
              fs.cpSync(src, dest, { recursive: true, force: true });
            }
          }
        },
      },
    ],
    server: {
      port: 3000,
      host: '0.0.0.0',
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

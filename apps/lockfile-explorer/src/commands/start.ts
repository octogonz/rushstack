// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import express from 'express';
import yaml from 'js-yaml';
import cors from 'cors';
import process from 'process';
import open from 'open';
import updateNotifier from 'update-notifier';
import { FileSystem, type IPackageJson, JsonFile, PackageJsonLookup } from '@rushstack/node-core-library';
import type { IAppContext } from '@rushstack/lockfile-explorer-web/lib/AppContext';
import { Colorize } from '@rushstack/terminal';
import type { Lockfile } from '@pnpm/lockfile-types';
import type { CommandModule } from 'yargs';

import { convertLockfileV6DepPathToV5DepPath, getShrinkwrapFileMajorVersion } from '../utils/shrinkwrap';
import { init } from '../utils/init';
import type { IAppState } from '../state';
import { terminal } from '../utils/logger';

interface IStartCommandOptions {
  subspace: string;
  debug?: boolean;
}

function startApp(subspaceName: string, debugMode: boolean): void {
  const lockfileExplorerProjectRoot: string = PackageJsonLookup.instance.tryGetPackageFolderFor(__dirname)!;
  const lockfileExplorerPackageJson: IPackageJson = JsonFile.load(
    `${lockfileExplorerProjectRoot}/package.json`
  );
  const appVersion: string = lockfileExplorerPackageJson.version;

  console.log(
    Colorize.bold(`\nRush Lockfile Explorer ${appVersion}`) + Colorize.cyan(' - https://lfx.rushstack.io/\n')
  );

  updateNotifier({
    pkg: lockfileExplorerPackageJson,
    // Normally update-notifier waits a day or so before it starts displaying upgrade notices.
    // In debug mode, show the notice right away.
    updateCheckInterval: debugMode ? 0 : undefined
  }).notify({
    // Make sure it says "-g" in the "npm install" example command line
    isGlobal: true,
    // Show the notice immediately, rather than waiting for process.onExit()
    defer: false
  });

  const PORT: number = 8091;
  // Must not have a trailing slash
  const SERVICE_URL: string = `http://localhost:${PORT}`;

  const appState: IAppState = init({ lockfileExplorerProjectRoot, appVersion, debugMode, subspaceName });

  // Important: This must happen after init() reads the current working directory
  process.chdir(appState.lockfileExplorerProjectRoot);

  const distFolderPath: string = `${appState.lockfileExplorerProjectRoot}/dist`;
  const app: express.Application = express();
  app.use(express.json());
  app.use(cors());

  // Variable used to check if the front-end client is still connected
  let awaitingFirstConnect: boolean = true;
  let isClientConnected: boolean = false;
  let disconnected: boolean = false;
  setInterval(() => {
    if (!isClientConnected && !awaitingFirstConnect && !disconnected) {
      console.log(Colorize.red('The client has disconnected!'));
      console.log(`Please open a browser window at http://localhost:${PORT}/app`);
      disconnected = true;
    } else if (!awaitingFirstConnect) {
      isClientConnected = false;
    }
  }, 4000);

  // This takes precedence over the `/app` static route, which also has an `initappcontext.js` file.
  app.get('/initappcontext.js', (req: express.Request, res: express.Response) => {
    const appContext: IAppContext = {
      serviceUrl: SERVICE_URL,
      appVersion: appState.appVersion,
      debugMode: process.argv.indexOf('--debug') >= 0
    };
    const sourceCode: string = [
      `console.log('Loaded initappcontext.js');`,
      `appContext = ${JSON.stringify(appContext)}`
    ].join('\n');

    res.type('application/javascript').send(sourceCode);
  });

  app.use('/', express.static(distFolderPath));

  app.use('/favicon.ico', express.static(distFolderPath, { index: 'favicon.ico' }));

  app.get('/api/lockfile', async (req: express.Request, res: express.Response) => {
    const pnpmLockfileText: string = await FileSystem.readFileAsync(appState.pnpmLockfileLocation);
    const doc = yaml.load(pnpmLockfileText) as Lockfile;
    const { packages, lockfileVersion } = doc;

    const shrinkwrapFileMajorVersion: number = getShrinkwrapFileMajorVersion(lockfileVersion);

    if (packages && shrinkwrapFileMajorVersion === 6) {
      const updatedPackages: Lockfile['packages'] = {};
      for (const [dependencyPath, dependency] of Object.entries(packages)) {
        updatedPackages[convertLockfileV6DepPathToV5DepPath(dependencyPath)] = dependency;
      }
      doc.packages = updatedPackages;
    }

    res.send({
      doc,
      subspaceName
    });
  });

  app.get('/api/health', (req: express.Request, res: express.Response) => {
    awaitingFirstConnect = false;
    isClientConnected = true;
    if (disconnected) {
      disconnected = false;
      console.log(Colorize.green('The client has reconnected!'));
    }
    res.status(200).send();
  });

  app.post(
    '/api/package-json',
    async (req: express.Request<{}, {}, { projectPath: string }, {}>, res: express.Response) => {
      const { projectPath } = req.body;
      const fileLocation = `${appState.projectRoot}/${projectPath}/package.json`;
      let packageJsonText: string;
      try {
        packageJsonText = await FileSystem.readFileAsync(fileLocation);
      } catch (e) {
        if (FileSystem.isNotExistError(e)) {
          return res.status(404).send({
            message: `Could not load package.json file for this package. Have you installed all the dependencies for this workspace?`,
            error: `No package.json in location: ${projectPath}`
          });
        } else {
          throw e;
        }
      }

      res.send(packageJsonText);
    }
  );

  app.get('/api/pnpmfile', async (req: express.Request, res: express.Response) => {
    let pnpmfile: string;
    try {
      pnpmfile = await FileSystem.readFileAsync(appState.pnpmfileLocation);
    } catch (e) {
      if (FileSystem.isNotExistError(e)) {
        return res.status(404).send({
          message: `Could not load pnpmfile file in this repo.`,
          error: `No .pnpmifile.cjs found.`
        });
      } else {
        throw e;
      }
    }

    res.send(pnpmfile);
  });

  app.post(
    '/api/package-spec',
    async (req: express.Request<{}, {}, { projectPath: string }, {}>, res: express.Response) => {
      const { projectPath } = req.body;
      const fileLocation = `${appState.projectRoot}/${projectPath}/package.json`;
      let packageJson: IPackageJson;
      try {
        packageJson = await JsonFile.loadAsync(fileLocation);
      } catch (e) {
        if (FileSystem.isNotExistError(e)) {
          return res.status(404).send({
            message: `Could not load package.json file in location: ${projectPath}`
          });
        } else {
          throw e;
        }
      }

      const {
        hooks: { readPackage }
      } = require(appState.pnpmfileLocation);
      const parsedPackage = readPackage(packageJson, {});
      res.send(parsedPackage);
    }
  );

  app.listen(PORT, async () => {
    console.log(`App launched on ${SERVICE_URL}`);

    if (!appState.debugMode) {
      try {
        // Launch the web browser
        await open(SERVICE_URL);
      } catch (e) {
        terminal.writeError('Error launching browser: ' + e.toString());
      }
    }
  });
}

// Example usage: lfx
// Example usage: lfx --subspace xxx
// Example usage: lockfile-explorer
// Example usage: lockfile-explorer --subspace xxx
export const startCommand: CommandModule<{}, IStartCommandOptions> = {
  command: '$0',
  describe: 'Start the application',
  builder: (yargs) => {
    return yargs
      .option('subspace', {
        describe: 'The subspace name where the package resides',
        type: 'string',
        default: 'default'
      })
      .option('debug', {
        type: 'boolean',
        describe: 'Enable debug mode',
        global: true
      });
  },
  handler: (args) => {
    try {
      startApp(args.subspace, args.debug ?? false);
    } catch (error) {
      terminal.writeError('ERROR: ' + error.message);
      process.exit(1);
    }
  }
};

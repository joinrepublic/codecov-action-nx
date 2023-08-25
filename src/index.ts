import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';
import {glob} from 'glob';

import * as exec from '@actions/exec';

import {buildExec, buildUploaderParams} from './buildExec';
import {
  getBaseUrl,
  getPlatform,
  getUploaderName,
  setFailure,
} from './helpers';

import verify from './validate';
import versionInfo from './version';

let failCi;


const getNxCoverageReports = ({verbose}) => {
  return glob.sync('coverage/**/*-final.json').map((coverageFilePath) => {
    const fileName = path.basename(coverageFilePath);
    const qualifiedPath = path.dirname(
        coverageFilePath,
    ).replace('coverage/', '');
    const flagName = qualifiedPath.replace(/^(libs|apps)\//, '');

    if (verbose) {
      console.log({
        message: 'Found coverage file',
        coverageFilePath,
        fileName,
        qualifiedPath,
        flagName,
      });
    }
    return {fileName, qualifiedPath, flagName, coverageFilePath};
  });
};

try {
  const {os, uploaderVersion, verbose} = buildUploaderParams();
  const platform = getPlatform(os);

  const filename = path.join( __dirname, getUploaderName(platform));
  https.get(getBaseUrl(platform, uploaderVersion), (res) => {
    // Image will be stored at this path
    const filePath = fs.createWriteStream(filename);
    res.pipe(filePath);
    filePath
        .on('error', (err) => {
          setFailure(
              `Codecov: Failed to write uploader binary: ${err.message}`,
              true,
          );
        }).on('finish', async () => {
          filePath.close();

          await verify(filename, platform, uploaderVersion, verbose, failCi);
          await versionInfo(platform, uploaderVersion);
          await fs.chmodSync(filename, '777');

          const unlink = () => {
            fs.unlink(filename, (err) => {
              if (err) {
                setFailure(
                    `Codecov: Could not unlink uploader: ${err.message}`,
                    failCi,
                );
              }
            });
          };
          Promise.all(
              getNxCoverageReports({ verbose }).map(({flagName, coverageFilePath}) => {
                const {execArgs, options, failCi} = buildExec({verbose, files: [coverageFilePath], flag: flagName});
                return exec.exec(filename, execArgs, options)
                    .catch((err) => {
                      setFailure(
                          `Codecov: Failed to properly upload: ${err.message}`,
                          failCi,
                      );
                    }).then(() => {
                      unlink();
                    });
              }),
          );
        });
  });
} catch (err) {
  setFailure(`Codecov: Encountered an unexpected error ${err.message}`, failCi);
}

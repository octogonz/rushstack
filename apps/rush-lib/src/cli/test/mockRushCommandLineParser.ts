// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

// Mock child_process so we can verify tasks are (or are not) invoked as we expect
jest.mock('child_process');

/**
 * Mock RushCommandLineParser itself to prevent `process.exit` to be called on failure
 */
jest.mock('../RushCommandLineParser', () => {
  // tslint:disable-next-line: no-any
  const actualModule: any = jest.requireActual('../RushCommandLineParser');
  if (actualModule.RushCommandLineParser) {
    // Stub out the troublesome method that calls `process.exit`
    actualModule.RushCommandLineParser.prototype._reportErrorAndSetExitCode = mockReportErrorAndSetExitCode;
  }
  return actualModule;

  function mockReportErrorAndSetExitCode(error: Error): void {
    // Just rethrow the error so the unit tests can catch it
    throw error;
  }
});

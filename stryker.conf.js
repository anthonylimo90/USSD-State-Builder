/**
 * Stryker Mutation Testing Configuration
 *
 * Mutation testing verifies that your tests actually catch bugs.
 * It works by making small changes (mutations) to your code and
 * checking if tests fail - if they don't, you have a testing gap.
 *
 * Install: npm install --save-dev @stryker-mutator/core @stryker-mutator/jest-runner
 * Run: npx stryker run
 */
module.exports = {
    packageManager: 'npm',
    reporters: ['html', 'clear-text', 'progress'],
    testRunner: 'jest',
    jest: {
        configFile: undefined, // Use default jest config from package.json
        enableFinding: true
    },
    coverageAnalysis: 'perTest',
    mutate: [
        'lib/**/*.js',
        '!lib/sdk/**/*.js' // Exclude SDK compiler (complex generated code)
    ],
    thresholds: {
        high: 80,
        low: 60,
        break: 50
    },
    timeoutMS: 30000,
    concurrency: 4,
    tempDirName: '.stryker-tmp'
};

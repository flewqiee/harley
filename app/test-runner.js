// test-runner.js — Professional test runner with pre-push gating, coverage, watch mode.
// Supports: Jest, Vitest, Mocha, PyTest, Cargo, Go test, npm scripts.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { FILES, HARLEY_DIR } = require('./config');

const TEST_FRAMEWORKS = {
  node: [
    { name: 'vitest', detect: ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mjs'], cmd: 'npx vitest run', watchCmd: 'npx vitest', coverage: 'npx vitest run --coverage' },
    { name: 'jest', detect: ['jest.config.ts', 'jest.config.js', 'jest.config.mjs', 'jest.config.json'], cmd: 'npx jest --ci --maxWorkers=50%', watchCmd: 'npx jest --watch', coverage: 'npx jest --coverage' },
    { name: 'mocha', detect: ['.mocharc.json', '.mocharc.js', 'mocha.opts'], cmd: 'npx mocha', watchCmd: 'npx mocha --watch', coverage: null },
    { name: 'npm test', detect: ['package.json'], cmd: 'npm test', watchCmd: null, coverage: null },
  ],
  python: [
    { name: 'pytest', detect: ['pytest.ini', 'pyproject.toml', 'setup.cfg', 'requirements.txt'], cmd: 'python -m pytest -v', watchCmd: 'python -m pytest -v --looponfail', coverage: 'python -m pytest --cov=.' },
    { name: 'unittest', detect: ['test_*.py', '*_test.py'], cmd: 'python -m unittest discover -v', watchCmd: null, coverage: 'python -m coverage run -m unittest discover' },
  ],
  rust: [
    { name: 'cargo test', detect: ['Cargo.toml'], cmd: 'cargo test', watchCmd: 'cargo watch -x test', coverage: 'cargo tarpaulin --out Xml' },
  ],
  go: [
    { name: 'go test', detect: ['go.mod'], cmd: 'go test ./... -v', watchCmd: null, coverage: 'go test ./... -coverprofile=coverage.out' },
  ],
  lua: [
    { name: 'busted', detect: ['busted.lua', 'spec/'], cmd: 'busted', watchCmd: null, coverage: 'busted --coverage' },
  ],
};

function detectProjectType(wsPath) {
  const has = (p) => fs.existsSync(path.join(wsPath, p));
  if (has('package.json')) return 'node';
  if (has('pyproject.toml') || has('requirements.txt') || has('setup.py') || has('Pipfile')) return 'python';
  if (has('Cargo.toml')) return 'rust';
  if (has('go.mod')) return 'go';
  if (has('busted.lua') || has('spec/')) return 'lua';
  return 'unknown';
}

function detectTestFramework(wsPath, type) {
  const frameworks = TEST_FRAMEWORKS[type] || [];
  for (const fw of frameworks) {
    for (const detect of fw.detect) {
      if (has(detect, wsPath)) return fw;
    }
  }
  // Fallback to first framework
  return frameworks[0] || null;
}

function has(file, wsPath) {
  try {
    return fs.existsSync(path.join(wsPath, file));
  } catch {
    return false;
  }
}

function runCommand(wsPath, cmd, options = {}) {
  const { timeout = 120000, env = {}, onStdout, onStderr, shell = true } = options;
  const isWin = process.platform === 'win32';
  const command = isWin ? 'cmd.exe' : '/bin/sh';
  const args = isWin ? ['/c', cmd] : ['-c', cmd];

  return new Promise((resolve) => {
    const cp = spawn(command, args, {
      cwd: wsPath,
      windowsHide: true,
      shell: false,
      env: { ...process.env, ...env },
    });

    let stdout = '', stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try { cp.kill('SIGTERM'); } catch { }
    }, timeout);

    cp.stdout?.on('data', (d) => {
      const str = String(d);
      stdout += str;
      if (onStdout) onStdout(str);
    });
    cp.stderr?.on('data', (d) => {
      const str = String(d);
      stderr += str;
      if (onStderr) onStderr(str);
    });

    cp.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, exitCode: -1, error: 'Spawn error: ' + e.message, stdout, stderr, timedOut: false });
    });

    cp.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        exitCode: code,
        error: timedOut ? 'Test timeout' : (code !== 0 ? stderr || stdout : null),
        stdout: stdout.slice(-10000),
        stderr: stderr.slice(-10000),
        timedOut,
      });
    });
  });
}

async function runTests(sessionId, options = {}) {
  const workspace = require('./workspace');
  const w = workspace.get(sessionId);
  if (!w) return { ok: false, error: 'No workspace bound' };

  const {
    framework = 'auto',
    watch = false,
    coverage = false,
    bail = false,
    filter = '',
    parallel = true,
    timeout = 120000,
    onProgress,
  } = options;

  const wsPath = w.path;
  const type = detectProjectType(wsPath);
  if (type === 'unknown') return { ok: false, error: 'No supported project type detected' };

  let fw = framework === 'auto' ? detectTestFramework(wsPath, type) : TEST_FRAMEWORKS[type]?.find(f => f.name === framework);
  if (!fw) return { ok: false, error: `Test framework not found for ${type}` };

  const cmd = coverage ? (fw.coverage || fw.cmd) : (watch ? (fw.watchCmd || fw.cmd) : fw.cmd);
  if (!cmd) return { ok: false, error: `${watch ? 'Watch' : coverage ? 'Coverage' : 'Test'} command not available for ${fw.name}` };

  const fullCmd = filter ? `${cmd} ${filter}` : cmd;

  if (onProgress) onProgress({ phase: 'start', framework: fw.name, command: fullCmd });

  const result = await runCommand(wsPath, fullCmd, {
    timeout,
    onStdout: (d) => onProgress?.({ phase: 'stdout', data: d }),
    onStderr: (d) => onProgress?.({ phase: 'stderr', data: d }),
  });

  // Parse results for summary
  const summary = parseTestOutput(result.stdout, fw.name);

  if (onProgress) onProgress({ phase: 'complete', ...result, summary, framework: fw.name });

  return {
    ...result,
    framework: fw.name,
    projectType: type,
    summary,
  };
}

function parseTestOutput(output, framework) {
  const lines = output.split('\n');
  let passed = 0, failed = 0, skipped = 0, total = 0;
  let duration = 0;
  const failures = [];

  if (framework === 'jest' || framework === 'vitest') {
    for (const line of lines) {
      const match = line.match(/Tests?:\s+(\d+)\s+(?:passed|failed|skipped)/i);
      if (match) total = parseInt(match[1]);
      if (line.includes('✓') || line.includes(' PASS ')) passed++;
      if (line.includes('✕') || line.includes(' FAIL ')) failed++;
      if (line.includes('skip')) skipped++;
      const dur = line.match(/(\d+\.?\d*)\s*s/);
      if (dur && !duration) duration = parseFloat(dur[1]);
      if (line.includes('FAIL') && line.includes('●')) {
        failures.push(line.trim());
      }
    }
  } else if (framework === 'pytest') {
    for (const line of lines) {
      if (line.includes('passed')) {
        const m = line.match(/(\d+)\s+passed/);
        if (m) passed = parseInt(m[1]);
      }
      if (line.includes('failed')) {
        const m = line.match(/(\d+)\s+failed/);
        if (m) failed = parseInt(m[1]);
      }
      if (line.includes('skipped')) {
        const m = line.match(/(\d+)\s+skipped/);
        if (m) skipped = parseInt(m[1]);
      }
      if (line.includes('=== FAILURES ===')) {
        // Collect failures after this
      }
    }
    total = passed + failed + skipped;
  } else if (framework === 'cargo test') {
    for (const line of lines) {
      if (line.includes('test result:')) {
        const m = line.match(/(\d+)\s+passed/);
        if (m) passed = parseInt(m[1]);
        const m2 = line.match(/(\d+)\s+failed/);
        if (m2) failed = parseInt(m2[1]);
      }
    }
    total = passed + failed;
  } else if (framework === 'go test') {
    for (const line of lines) {
      if (line.startsWith('--- PASS:')) passed++;
      if (line.startsWith('--- FAIL:')) { failed++; failures.push(line.trim()); }
      if (line.startsWith('--- SKIP:')) skipped++;
    }
    total = passed + failed + skipped;
  } else {
    // Generic
    for (const line of lines) {
      if (/pass|ok|success/i.test(line)) passed++;
      if (/fail|error/i.test(line)) failed++;
    }
    total = passed + failed;
  }

  return { passed, failed, skipped, total, duration, failures: failures.slice(0, 10) };
}

async function runCoverage(sessionId) {
  return runTests(sessionId, { coverage: true });
}

async function runTestsWatch(sessionId, onProgress) {
  return runTests(sessionId, { watch: true, onProgress });
}

function getTestConfig(sessionId) {
  const workspace = require('./workspace');
  const w = workspace.get(sessionId);
  if (!w) return null;

  const wsPath = w.path;
  const type = detectProjectType(wsPath);
  const fw = detectTestFramework(wsPath, type);

  return {
    projectType: type,
    framework: fw?.name || 'none',
    hasWatch: !!fw?.watchCmd,
    hasCoverage: !!fw?.coverage,
    commands: fw ? {
      test: fw.cmd,
      watch: fw.watchCmd,
      coverage: fw.coverage,
    } : null,
  };
}

// Pre-push gate: run tests, block push on failure
async function prePushGate(sessionId, options = {}) {
  const { strict = true, timeout = 180000 } = options;
  const result = await runTests(sessionId, { timeout, bail: strict });
  return {
    allowPush: result.ok || !strict,
    result,
    message: result.ok ? 'All tests passed ✓' : `Tests failed (${result.summary.failed} failed, ${result.summary.passed} passed)`,
  };
}

module.exports = {
  runTests,
  runCoverage,
  runTestsWatch,
  getTestConfig,
  prePushGate,
  detectProjectType,
  detectTestFramework,
  TEST_FRAMEWORKS,
};
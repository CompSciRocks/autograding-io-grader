const { execSync } = require('child_process')
const core = require('@actions/core')

const env = {
  PATH: process.env.PATH,
  FORCE_COLOR: 'true',
  DOTNET_CLI_HOME: '/tmp',
  DOTNET_NOLOGO: 'true',
  HOME: process.env.HOME,
}

function getInputs() {
  const testName = core.getInput('test-name', {
    required: true,
  })
  const setupCommand = core.getInput('setup-command')
  const command = core.getInput('command', {
    required: true,
  })
  const input = core.getInput('input').trim()
  const expectedOutput = core.getInput('expected-output', {
    required: true,
  })
  const comparisonMethod = core.getInput('comparison-method', {
    required: true,
  })
  const timeout = parseFloat(core.getInput('timeout') || 10) * 60000 // Convert to minutes

  const maxScore = parseInt(core.getInput('max-score') || 0)

  const looseOptions = {
    trim: ['1', 'true', 'yes'].includes(core.getInput('loose-trim').toLowerCase()),
    lTrim: ['1', 'true', 'yes'].includes(core.getInput('loose-ltrim').toLowerCase()),
    rTrim: ['1', 'true', 'yes'].includes(core.getInput('loose-rtrim').toLowerCase()),
    ignoreBlank: ['1', 'true', 'yes'].includes(core.getInput('loose-ignore-blank-lines').toLowerCase()),
    squashSpaces: ['1', 'true', 'yes'].includes(core.getInput('loose-squash-spaces').toLowerCase()),
  }

  const outputFormat = core.getInput('output-format')

  if (!['exact', 'contains', 'regex', 'loose'].includes(comparisonMethod)) {
    throw new Error(`Invalid comparison method: ${comparisonMethod}`)
  }

  if (!testName || !command || !expectedOutput || !comparisonMethod) {
    throw new Error('Required inputs are missing or invalid')
  }

  return {
    testName,
    setupCommand,
    command,
    input,
    expectedOutput,
    comparisonMethod,
    timeout,
    maxScore,
    looseOptions,
    outputFormat,
  }
}

function executeTest(command, input, timeout) {
  try {
    const output = execSync(command, {
      input,
      timeout,
      env,
    })
      .toString()
      .trim()
    return {
      output,
    }
  } catch (e) {
    const message = e.message.includes('ETIMEDOUT') ? 'Command was killed due to timeout' : e.message
    return {
      error: message,
    }
  }
}

function compareOutput(output, expected, method) {
  switch (method) {
    case 'exact':
      return output === expected
    case 'contains':
      return output.includes(expected)
    case 'regex': {
      const regex = new RegExp(expected)
      return regex.test(output)
    }
    case 'loose':
      return compareLoose(output, expected)
    default:
      throw new Error(`Invalid comparison method: ${method}`)
  }
}

function compareLoose(output, expected) {
  let inputs = {};
  inputs = getInputs();

  let { trim, lTrim, rTrim, ignoreBlank, squashSpaces } = inputs.looseOptions

  let outputLines = output.split('\r?\n')
  let expectedLines = expected.split('\r?\n')

  if (trim || rTrim) {
    outputLines = outputLines.map((line) => line.trimEnd())
    expectedLines = expectedLines.map((line) => line.trimEnd())
  }
  if (trim || lTrim) {
    outputLines = outputLines.map((line) => line.trimStart())
    expectedLines = expectedLines.map((line) => line.trimStart())
  }
  if (ignoreBlank) {
    outputLines = outputLines.filter((line) => line.trim() !== '')
    expectedLines = expectedLines.filter((line) => line.trim() !== '')
  }
  if (squashSpaces) {
    outputLines = outputLines.map((line) => line.replace(/\s+/g, ' '))
    expectedLines = expectedLines.map((line) => line.replace(/\s+/g, ' '))
  }

  if (outputLines.length !== expectedLines.length) {
    return false
  }

  for (let i = 0; i < outputLines.length; i++) {
    if (outputLines[i] !== expectedLines[i]) {
      return false
    }
  }

  return true
}

function run() {
  let inputs = {}

  try {
    inputs = getInputs()

    if (inputs.setupCommand) {
      execSync(inputs.setupCommand, {
        timeout: inputs.timeout,
        stdio: 'inherit',
        env,
      })
    }

    const startTime = new Date()
    const { output, error } = executeTest(inputs.command, inputs.input, inputs.timeout)
    const endTime = new Date()

    let status = 'pass'
    let message = null
    let score = inputs.maxScore

    let runResults = {
      expected: inputs.expectedOutput,
      actual: null,
    }

    if (error) {
      status = 'error'
      message = error
      score = 0
      runResults.actual = ''
    } else if (!compareOutput(output, inputs.expectedOutput, inputs.comparisonMethod)) {
      status = 'fail'
      message = `Output does not match expected: ${inputs.expectedOutput} Got: ${output}`
      score = 0
      runResults.actual = output
    }

    const result = {
      version: 1,
      status,
      max_score: inputs.maxScore,
      markdown: '',
      tests: [
        {
          name: inputs.testName,
          status,
          message,
          test_code: `${inputs.command} <stdin>${inputs.input}`,
          filename: '',
          line_no: 0,
          execution_time: `${(endTime - startTime) / 1000}s`,
          score,
          runResults,
        },
      ],
    }

    let markdown = '';
    let text = '';

    if (status === 'fail') {
      text += '❌ Test Failed\n';
      markdown += '❌ Test Failed\n';
    } else if (status === 'error') {
      text += '💥 Error Executing Code\n';
      markdown += '💥 Error Executing Code\n';
    } else if (status === 'pass') {
      text += '✅ Test Passed\n';
      markdown += '✅ Test Passed\n';
    }

    text += '\n';

    text += 'Test Results:\n';
    text += '-------------\n';
    text += `Name: ${inputs.testName}\n`;
    text += `Status: ${status}\n`;
    text += 'Score: ' + score + ' / ' + inputs.maxScore + '\n';
    text += 'Execution Time: ' + (endTime - startTime) / 1000 + 's\n';

    if (inputs.input.trim() !== '') {
      text += '\nInput:\n';
      text += '------\n';
      text += inputs.input + '\n';

      markdown += '\n**Input:**\n';
      markdown += '```\n';
      markdown += inputs.input;
      markdown += '\n```\n';
    }

    text += '\n';

    if (status === 'fail') {

      text += 'Expected Output:\n';
      text += '----------------\n';
      text += inputs.expectedOutput + '\n';
      text += '\n';
      text += 'Your Output:\n';
      text += '------------\n';
      text += output + '\n';

      markdown += '\n**Expected Output:**\n';
      markdown += '```\n';
      markdown += inputs.expectedOutput;
      markdown += '\n```\n';

      markdown += '\n**Your Output:**\n';
      markdown += '```\n';
      markdown += output;
      markdown += '\n```\n';
    } else if (status === 'error') {
      text += 'Error Message:\n';
      text += '--------------\n';
      text += error + '\n';

      markdown += '\n**Error Message:**\n';
      markdown += '```\n';
      markdown += error;
      markdown += '\n```\n';
    } else if (status === 'pass') {
      text += 'Your Output:\n';
      text += '------------\n';
      text += output + '\n';

      markdown += '\n**Your Output:**\n';
      markdown += '```\n';
      markdown += output;
      markdown += '```\n';
    } else {
      text += '\nUnknown run status status: ' + status;
      markdown += '\nUnknown run status status: ' + status;
    }


    if (inputs.outputFormat === 'text') {
      console.log(text);
    } else {
      console.log(result);
    }

    result.markdown = btoa(markdown);

    core.setOutput('result', btoa(JSON.stringify(result)))


  } catch (error) {

    let markdown = '### Error\n\n';
    markdown += '```\n';
    markdown += error;
    markdown += '\n```';

    const result = {
      version: 1,
      status: 'error',
      tests: [
        {
          name: inputs.testName || 'Unknown Test',
          status: 'error',
          message: error.message,
          test_code: `${inputs.command || 'Unknown Command'} <stdin>${inputs.input || ''}`,
          filename: '',
          line_no: 0,
          execution_time: 0,
        },
      ],
    }
    core.setOutput('result', btoa(JSON.stringify(result)))

  }
}

function btoa(str) {
  return Buffer.from(str).toString('base64')
}

run()

// src/tools.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as readline from 'readline/promises'; // readline.Interface を型として利用
import {
  ListFileParams,
  ReadFileParams,
  WriteFileParams,
  AskQuestionParams,
  ExecuteCommandParams,
  CompleteParams,
  ToolResponse,
} from './types';

const execAsync = promisify(exec); // execをPromise化

// readline インターフェースのグローバル定義は削除

/**
 * ターミナルでユーザーに Yes/No の確認を求める共通関数
 * @param rl readlineインターフェースのインスタンス
 * @param question 確認メッセージ
 * @returns ユーザーが 'y' または 'Y' を入力した場合に true、それ以外は false
 */
async function askForUserApproval(rl: readline.Interface, question: string): Promise<boolean> {
  // 引数で渡された rl インターフェースを使用
  const answer = await rl.question(`${question} [y/n]: `);
  return answer.toLowerCase() === 'y';
}

// --- ツール定数 ---
export const ToolType = {
    ListFile: 'list_file',
    ReadFile: 'read_file',
    WriteFile: 'write_file',
    AskQuestion: 'ask_question',
    ExecuteCommand: 'execute_command',
    Complete: 'complete',
} as const;

// --- ツール実装 (必要な関数は引数に rl: readline.Interface を追加) ---

// 1. ListFile - ディレクトリ内のファイル一覧を取得 (rl は不要)
export async function listFile(params: ListFileParams): Promise<ToolResponse> {
  try {
    const targetPath = params.path || '.';
    const recursive = params.recursive?.toLowerCase() === 'true';
    const files: string[] = [];

    async function readDirRecursive(dir: string): Promise<void> {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        files.push(fullPath);
        if (recursive && entry.isDirectory()) {
          await readDirRecursive(fullPath);
        }
      }
    }

    if (recursive) {
      await readDirRecursive(targetPath);
    } else {
      const entries = await fs.readdir(targetPath);
      files.push(...entries.map(entry => path.join(targetPath, entry)));
    }

    const result = `Directory ${targetPath} listing:\n${files.map(f => `- ${f}`).join('\n')}`;
    return { success: true, message: result };
  } catch (error: any) {
    return { success: false, message: `Failed to list directory: ${error.message}` };
  }
}

// 2. ReadFile - ファイルの内容を読み取る (rl は不要)
export async function readFile(params: ReadFileParams): Promise<ToolResponse> {
  try {
    if (params.path.includes('..')) {
         return { success: false, message: 'Invalid path: Path traversal detected.' };
    }
    const content = await fs.readFile(params.path, 'utf-8');
    return { success: true, message: content };
  } catch (error: any) {
    return { success: false, message: `Failed to read file: ${error.message}` };
  }
}

// 3. WriteFile - ファイルに内容を書き込む (rl が必要)
export async function writeFile(rl: readline.Interface, params: WriteFileParams): Promise<ToolResponse> {
  try {
    if (params.path.includes('..')) {
        return { success: false, message: 'Invalid path: Path traversal detected.' };
    }

    // ユーザー確認 (引数の rl を使用)
    const confirmationMessage = `\n⚠️ Action Required: Attempting to write to file "${params.path}".\n   Content preview (first 100 chars):\n   "${params.content.substring(0, 100)}${params.content.length > 100 ? '...' : ''}"\n\nDo you want to allow this write operation?`;
    const isApproved = await askForUserApproval(rl, confirmationMessage); // ★ rl を渡す

    if (!isApproved) {
      console.log("Write operation cancelled by user.");
      return { success: false, message: 'Write operation cancelled by user.' };
    }

    // --- 承認された場合のみ以下の処理を実行 ---
    console.log(`User approved writing to ${params.path}. Proceeding...`);
    const dir = path.dirname(params.path);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(params.path, params.content, 'utf-8');
    return { success: true, message: `Successfully wrote to file ${params.path}` };
  } catch (error: any) {
    return { success: false, message: `Failed to write file: ${error.message}` };
  }
}

// 4. AskQuestion - ユーザーに質問する (rl が必要)
export async function askQuestion(rl: readline.Interface, params: AskQuestionParams): Promise<ToolResponse> {
  try {
    // 引数の rl を使用
    const answer = await rl.question(`\nQuestion: ${params.question}\nAnswer: `); // ★ rl を使う
    return { success: true, message: `User answer: ${answer}` };
  } catch (error: any) {
    return { success: false, message: `Failed to ask question: ${error.message}` };
  }
}

// 5. ExecuteCommand - コマンドを実行する (rl が必要)
export async function executeCommand(rl: readline.Interface, params: ExecuteCommandParams): Promise<ToolResponse> {
  try {
    // 常にユーザー確認を行う (引数の rl を使用)
    const confirmationMessage = `\n☢️ Action Required: Attempting to execute the following command:\n\n   ${params.command}\n\nDo you want to allow this command execution?`;
    const isApproved = await askForUserApproval(rl, confirmationMessage); // ★ rl を渡す

    if (!isApproved) {
      console.log("Command execution cancelled by user.");
      return { success: false, message: 'Command execution cancelled by user.' };
    }

    // --- 承認された場合のみ以下の処理を実行 ---
    console.log(`User approved command execution. Executing: ${params.command}`);
    const { stdout, stderr } = await execAsync(params.command);

    if (stderr) {
      console.warn(`Command stderr:\n${stderr}`);
    }

    const resultMessage = `Command executed successfully.${stdout ? `\nOutput:\n${stdout}` : ''}`;
    return { success: true, message: resultMessage };
  } catch (error: any) {
    const errorMessage = `Failed to execute command: ${error.message}\n${error.stderr ? `Stderr: ${error.stderr}\n` : ''}${error.stdout ? `Stdout: ${error.stdout}` : ''}`;
    return { success: false, message: errorMessage };
  }
}

// 6. Complete - タスクの完了を示す (rl は不要)
export async function complete(params: CompleteParams): Promise<ToolResponse> {
  return { success: true, message: `Task completed: ${params.result}` };
}
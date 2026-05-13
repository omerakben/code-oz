import { LogType, LogEntry } from './types';

/**
 * OzBridge encapsulates the communication logic between the GUI and the CLI.
 * Currently simulates responses, but structured for future real-world integration.
 */
class OzBridge {
  private static instance: OzBridge;
  
  private constructor() {}

  public static getInstance(): OzBridge {
    if (!OzBridge.instance) {
      OzBridge.instance = new OzBridge();
    }
    return OzBridge.instance;
  }

  /**
   * Simulates running a CLI command.
   * In the future, this could use a WebSocket or a local API to hit the real code-oz CLI.
   */
  public async executeCommand(
    command: string, 
    onLog: (type: LogType, content: string) => void
  ): Promise<void> {
    onLog(LogType.COMMAND, command);
    
    // Simulate typical CLI latency and multi-step output
    if (command.startsWith('init')) {
      await this.sleep(400);
      onLog(LogType.OUTPUT, 'Initializing project...');
      await this.sleep(800);
      onLog(LogType.SUCCESS, 'Project structure initialized at ./code-oz-project');
    } else if (command.startsWith('sync')) {
      await this.sleep(300);
      onLog(LogType.OUTPUT, 'Scanning workspace for sync targets...');
      await this.sleep(700);
      onLog(LogType.SUCCESS, 'Files aligned with Oz cluster.');
    } else if (command.startsWith('repair')) {
      await this.sleep(500);
      onLog(LogType.OUTPUT, 'Running repair against local assets...');
      await this.sleep(1000);
      onLog(LogType.OUTPUT, 'Refactor: relay.ts:1-120');
      await this.sleep(400);
      onLog(LogType.SUCCESS, 'Performance optimized by 22%.');
    } else {
      await this.sleep(500);
      onLog(LogType.OUTPUT, `Processing request: ${command}`);
      await this.sleep(500);
      onLog(LogType.SUCCESS, 'Operation completed.');
    }
  }

  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const ozBridge = OzBridge.getInstance();

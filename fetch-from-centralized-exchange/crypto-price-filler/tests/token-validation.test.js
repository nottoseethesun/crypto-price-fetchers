import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import path from 'path';

const indexPath = path.resolve(__dirname, '../index.js');

describe('Token validation', () => {
    it('rejects unsupported token with error listing supported tokens', () => {
      let stderr = '';
      let exitCode = 0;

      try {
        execSync(`node ${indexPath} --token=fakecoin --input=/dev/null`, {
          encoding: 'utf8',
          stdio: 'pipe',
          timeout: 2000,
        });
      } catch (err) {
        exitCode = err.status;
        stderr = err.stderr || '';
      }

      expect(exitCode).toBe(1);
      expect(stderr).toContain('Unknown token symbol "fakecoin"');
      expect(stderr).toContain('Supported tokens:');
      expect(stderr).toContain('grc');
      expect(stderr).toContain('xtm');
      expect(stderr).toContain('xtz');
      expect(stderr).toContain('btc');
      expect(stderr).toContain('supported-tokens.json');
    });

    it('accepts a valid token without token validation error', () => {
      let stderr = '';

      try {
        execSync(`node ${indexPath} --token=xtz --input=/dev/null`, {
          encoding: 'utf8',
          stdio: 'pipe',
          timeout: 2000,
        });
      } catch (err) {
        stderr = err.stderr || '';
      }

      // Should NOT contain the unknown token error (may still fail for other reasons like empty CSV)
      expect(stderr).not.toContain('Unknown token symbol');
    });

    it('is case-insensitive for token symbols', () => {
      let stderr = '';

      try {
        execSync(`node ${indexPath} --token=XTZ --input=/dev/null`, {
          encoding: 'utf8',
          stdio: 'pipe',
          timeout: 2000,
        });
      } catch (err) {
        stderr = err.stderr || '';
      }

      expect(stderr).not.toContain('Unknown token symbol');
    });
});

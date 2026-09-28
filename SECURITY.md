# Security policy

## Supported versions

Only the latest published version of `grove-multirepo` receives security fixes.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Don't open a public issue.

Include the Grove version, macOS version, the steps to reproduce, and what you observed. You should get an acknowledgement within a week.

## What counts

Grove manages Git worktrees and can delete or move files on your behalf, and it handles remote URLs. Reports in these areas are especially welcome:

- Grove deleting, moving or overwriting content without recorded consent.
- Credentials from a remote URL or Git configuration appearing in Grove output, error messages or files under `.grove/`.
- Grove reading or writing outside the workspace it was pointed at.

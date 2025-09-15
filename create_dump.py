import os

# --- Configuration ---
# The name of the output file
output_filename = "ai_dump.txt"

# Directories to completely ignore
# We modify the 'dirs' list in-place in the walk to prevent traversal
dirs_to_ignore = {
    "node_modules",
    ".venv",
    ".git",
    "__pycache__",
    "dist",
    "build",
    "static", # SvelteKit's static dir is usually for pre-built assets
    ".svelte-kit" # SvelteKit build output
}

# File extensions to ignore
extensions_to_ignore = {
    ".pyc",
    ".db",
    ".db-shm",
    ".db-wal",
    ".log",
    # Common image/media formats
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico",
    ".mp4", ".mov", ".avi",
    ".pdf"
}

# Specific files to ignore by name.
# This is the main change to filter out noise.
files_to_ignore = {
    # --- General ---
    output_filename,    # Don't include the script's own output
    "create_dump.py",   # Don't include this script itself
    ".DS_Store",
    "README.md",
    ".gitignore",

    # --- Dependency Lock Files (VERY IMPORTANT TO IGNORE) ---
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",

    # --- Linting & Formatting Configs ---
    "eslint.config.js",
    ".eslintrc.js",
    ".eslintrc.json",
    ".prettierrc",
    ".prettierignore",
    ".npmrc",
    
    # --- TS Config (often boilerplate) ---
    "tsconfig.json" 
}
# --- End Configuration ---

def create_project_dump():
    """
    Walks through the project directory and creates a single text file
    containing the structure and content of all relevant files.
    """
    print(f"Starting focused project dump... Output will be in '{output_filename}'")
    
    # Overwrite the file to ensure it's fresh
    with open(output_filename, "w", encoding="utf-8") as outfile:
        # os.walk('.') starts from the current directory
        for root, dirs, files in os.walk("."):
            # --- Directory Filtering ---
            dirs[:] = [d for d in dirs if d not in dirs_to_ignore]

            # Sort for consistent ordering
            dirs.sort()
            files.sort()

            for filename in files:
                # --- File Filtering ---
                if filename in files_to_ignore:
                    continue
                
                if os.path.splitext(filename)[1] in extensions_to_ignore:
                    continue

                full_path = os.path.join(root, filename)
                
                separator = "=" * 80
                header = f"{separator}\nFile: {full_path.replace(os.path.sep, '/')}\n{separator}\n\n"
                
                try:
                    with open(full_path, "r", encoding="utf-8", errors="ignore") as infile:
                        content = infile.read()
                        
                    outfile.write(header)
                    outfile.write(content)
                    outfile.write("\n\n") # Add space between files
                    
                    print(f"  + Added: {full_path}")

                except Exception as e:
                    print(f"  - Could not read file {full_path}: {e}")

    print("-" * 20)
    print(f"✅ Success! Focused project dump created at '{output_filename}'.")
    print("You can now copy the contents of that file and paste it to me.")


if __name__ == "__main__":
    create_project_dump()
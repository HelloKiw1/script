#!/usr/bin/env python3
"""
Duplicate File Detector

Analyzes a folder for duplicate files using two methods:
1. Same filename + size + content (current script logic)
2. Same size + content (regardless of filename)
"""

import os
import hashlib
from collections import defaultdict
from pathlib import Path

def get_file_hash(filepath, blocksize=65536):
    """Calculate MD5 hash of file content"""
    hasher = hashlib.md5()
    try:
        with open(filepath, 'rb') as f:
            buf = f.read(blocksize)
            while len(buf) > 0:
                hasher.update(buf)
                buf = f.read(blocksize)
        return hasher.hexdigest()
    except Exception as e:
        print(f"Error hashing {filepath}: {e}")
        return None

def main():
    folder_path = r"C:\Users\icaro\Downloads\decreto palmeirante 2024"
    
    if not os.path.exists(folder_path):
        print(f"ERROR: Folder not found: {folder_path}")
        return

    # Collect all files with their metadata
    files = []
    for root, dirs, filenames in os.walk(folder_path):
        for filename in filenames:
            filepath = os.path.join(root, filename)
            try:
                size = os.path.getsize(filepath)
                file_hash = get_file_hash(filepath)
                if file_hash:
                    files.append({
                        'path': filepath,
                        'name': filename,
                        'size': size,
                        'hash': file_hash
                    })
            except Exception as e:
                print(f"Error processing {filepath}: {e}")

    print(f"\n{'='*90}")
    print(f"DUPLICATE FILE ANALYSIS")
    print(f"{'='*90}")
    print(f"Folder: {folder_path}")
    print(f"Total files found: {len(files)}\n")

    # METHOD 1: Same filename + size + content
    print(f"{'='*90}")
    print("METHOD 1: Same filename + same size + same content")
    print(f"{'='*90}")

    method1_duplicates = defaultdict(list)
    for f in files:
        key = (f['name'], f['size'], f['hash'])
        method1_duplicates[key].append(f['path'])

    # Count groups with duplicates
    method1_dup_groups = {k: v for k, v in method1_duplicates.items() if len(v) > 1}
    method1_dup_count = sum(len(v) - 1 for v in method1_dup_groups.values())

    print(f"\nDuplicate groups found:  {len(method1_dup_groups)}")
    print(f"Total duplicate files:   {method1_dup_count}")

    if method1_dup_groups:
        print("\nTop examples of duplicates:")
        sorted_groups = sorted(method1_dup_groups.items(), key=lambda x: len(x[1]), reverse=True)
        for i, (key, paths) in enumerate(sorted_groups[:5]):
            name, size, hash_val = key
            print(f"\n  Example {i+1}: '{name}' ({size:,} bytes) - {len(paths)} copies")
            for j, path in enumerate(paths[:3], 1):
                relpath = os.path.relpath(path, folder_path)
                print(f"    {j}. {relpath}")
            if len(paths) > 3:
                print(f"    ... and {len(paths)-3} more copy(ies)")
    else:
        print("\n✓ No duplicates found by this method.")

    # METHOD 2: Same size + content (any filename)
    print(f"\n\n{'='*90}")
    print("METHOD 2: Same size + same content (regardless of filename)")
    print(f"{'='*90}")

    method2_duplicates = defaultdict(list)
    for f in files:
        key = (f['size'], f['hash'])
        method2_duplicates[key].append(f['path'])

    # Count groups with duplicates
    method2_dup_groups = {k: v for k, v in method2_duplicates.items() if len(v) > 1}
    method2_dup_count = sum(len(v) - 1 for v in method2_dup_groups.values())

    print(f"\nDuplicate groups found:  {len(method2_dup_groups)}")
    print(f"Total duplicate files:   {method2_dup_count}")

    if method2_dup_groups:
        print("\nTop examples of duplicates:")
        sorted_groups = sorted(method2_dup_groups.items(), key=lambda x: len(x[1]), reverse=True)
        for i, (key, paths) in enumerate(sorted_groups[:5]):
            size, hash_val = key
            print(f"\n  Example {i+1}: {size:,} bytes - {len(paths)} copies")
            for j, path in enumerate(paths[:3], 1):
                relpath = os.path.relpath(path, folder_path)
                filename = os.path.basename(path)
                print(f"    {j}. {filename}")
            if len(paths) > 3:
                print(f"    ... and {len(paths)-3} more copy(ies)")
    else:
        print("\n✓ No duplicates found by this method.")

    # Summary
    print(f"\n\n{'='*90}")
    print("SUMMARY")
    print(f"{'='*90}")
    print(f"Total files analyzed:           {len(files)}")
    print(f"\nMethod 1 (filename+size+hash):")
    print(f"  - Duplicate groups:           {len(method1_dup_groups)}")
    print(f"  - Total duplicate files:      {method1_dup_count}")
    print(f"\nMethod 2 (size+hash only):")
    print(f"  - Duplicate groups:           {len(method2_dup_groups)}")
    print(f"  - Total duplicate files:      {method2_dup_count}")

    # Additional duplicates found by method 2 but not method 1
    new_dups = len(method2_dup_groups) - len(method1_dup_groups)
    if new_dups > 0:
        print(f"\nAdditional duplicates detected by Method 2: {new_dups} group(s)")
        print("(These are duplicates with different filenames)")

    print(f"{'='*90}\n")

if __name__ == "__main__":
    main()

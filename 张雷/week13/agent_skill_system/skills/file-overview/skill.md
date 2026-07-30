---
name: file-overview
description: 给定目录，统计文件数量并预览首个文件的前若干行；仅读操作。
---

## 执行指令
1. 用 count_files 工具统计目标目录下的文件数量。
2. 用 peek_file 工具预览指定文件的前 10 行。
仅读，不要修改或删除任何文件。

## 所需工具
- count_files：统计目录下文件数；用命令 `ls {dir} | wc -l`；参数 dir（目录路径）。
- peek_file：预览文件前 10 行；用命令 `head -n 10 {path}`；参数 path（文件路径）。

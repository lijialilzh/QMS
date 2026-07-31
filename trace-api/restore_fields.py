import os
# 恢复 updateFields=true
count1 = 0
for root, dirs, files in os.walk('src/serv'):
    for f in files:
        if f.endswith('.py'):
            path = os.path.join(root, f)
            with open(path, 'r', encoding='utf-8') as fh:
                content = fh.read()
            old = 'update_fields.set(qn("w:val"), "false")'
            new = 'update_fields.set(qn("w:val"), "true")'
            if old in content:
                content = content.replace(old, new)
                with open(path, 'w', encoding='utf-8') as fh:
                    fh.write(content)
                count1 += 1
print(f'updateFields=true: {count1} files')

# 恢复 w:dirty=true
count2 = 0
dirty_line = 'fld_begin.set(qn("w:dirty"), "true")'
for root, dirs, files in os.walk('src/serv'):
    for f in files:
        if f.endswith('.py'):
            path = os.path.join(root, f)
            with open(path, 'r', encoding='utf-8') as fh:
                lines = fh.readlines()
            has_begin = any('fldCharType"), "begin")' in l for l in lines)
            has_dirty = any(dirty_line in l for l in lines)
            if has_begin and not has_dirty:
                new_lines = []
                for l in lines:
                    new_lines.append(l)
                    if 'fld_begin.set(qn("w:fldCharType"), "begin")' in l:
                        indent = l[:len(l) - len(l.lstrip())]
                        new_lines.append(indent + dirty_line + '\n')
                with open(path, 'w', encoding='utf-8') as fh:
                    fh.writelines(new_lines)
                count2 += 1
                print(f'restored dirty: {path}')
print(f'restored w:dirty=true: {count2} files')
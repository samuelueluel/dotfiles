#!/bin/bash

# 1. Pipe a multiline JS script directly into CopyQ to bypass all shell parsing bugs
selected=$(copyq eval - << 'EOF' | fzf --keep-right --reverse --border=rounded --prompt="Clipboard ❯ " --with-nth=2 --delimiter=":::"
var arr = [];
var count = size();
for (var i = 0; i < count; ++i) {
    var text = str(read(i));
    var clean = text.replace(/\r?\n/g, " ↵ ").substring(0, 150);
    arr.push(i + ":::" + clean);
}
print(arr.join("\n") + "\n");
EOF
)

# 2. Exit if nothing is selected (Esc pressed)
if [ -z "$selected" ]; then
    exit 0
fi

# 3. Extract the ID number
index=$(echo "$selected" | awk -F':::' '{print $1}')

# 4. Move that item to the top of the clipboard
copyq select "$index"

exit 0

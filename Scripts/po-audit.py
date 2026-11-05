import re
import glob
import sys


def po_ids(path):
    out = set()
    for line in open(path, encoding='utf-8'):
        line = line.rstrip('\n')
        if line.startswith('msgid "') and line.endswith('"'):
            raw = line[7:-1]
            out.add(raw.replace('\\"', '"').replace('\\\\', '\\'))
    return out


def js_ids(path):
    src = open(path, encoding='utf-8').read()
    pat = re.compile(r"_\( *'((?:[^'\\]|\\.)*)'")
    return set(m.group(1) for m in pat.finditer(src))


def main():
    po = sys.argv[1]
    have = po_ids(po)
    found = set()
    for f in sorted(glob.glob(sys.argv[2])):
        found |= js_ids(f)
    missing = sorted(i for i in found if i not in have)
    print("JS msgids: %d, present in po: %d, missing: %d" %
          (len(found), len(found) - len(missing), len(missing)))
    for m in missing:
        print("  MISS %r" % m)
    return missing


if __name__ == '__main__':
    main()

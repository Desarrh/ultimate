//! Minimal parser for Valve's KeyValues (.vdf / .acf) text format.

#[derive(Debug, Clone)]
pub enum Vdf {
    Str(String),
    Obj(Vec<(String, Vdf)>),
}

impl Vdf {
    pub fn get(&self, key: &str) -> Option<&Vdf> {
        match self {
            Vdf::Obj(v) => v.iter().find(|(k, _)| k.eq_ignore_ascii_case(key)).map(|(_, x)| x),
            _ => None,
        }
    }
    pub fn path(&self, keys: &[&str]) -> Option<&Vdf> {
        keys.iter().try_fold(self, |n, k| n.get(k))
    }
    pub fn str(&self, key: &str) -> Option<&str> {
        match self.get(key)? {
            Vdf::Str(s) => Some(s),
            _ => None,
        }
    }
    pub fn num(&self, key: &str) -> u64 {
        self.str(key).and_then(|s| s.parse().ok()).unwrap_or(0)
    }
    pub fn entries(&self) -> &[(String, Vdf)] {
        match self {
            Vdf::Obj(v) => v,
            _ => &[],
        }
    }
}

pub fn parse(src: &str) -> Vdf {
    let tokens = tokenize(src);
    let mut i = 0;
    Vdf::Obj(parse_obj(&tokens, &mut i))
}

enum Tok {
    S(String),
    Open,
    Close,
}

fn tokenize(src: &str) -> Vec<Tok> {
    let mut out = Vec::new();
    let mut it = src.chars().peekable();
    while let Some(c) = it.next() {
        match c {
            '"' => {
                let mut s = String::new();
                while let Some(c) = it.next() {
                    match c {
                        '\\' => match it.next() {
                            Some('n') => s.push('\n'),
                            Some('t') => s.push('\t'),
                            Some(o) => s.push(o),
                            None => {}
                        },
                        '"' => break,
                        o => s.push(o),
                    }
                }
                out.push(Tok::S(s));
            }
            '{' => out.push(Tok::Open),
            '}' => out.push(Tok::Close),
            '/' if it.peek() == Some(&'/') => {
                for c in it.by_ref() {
                    if c == '\n' {
                        break;
                    }
                }
            }
            c if c.is_whitespace() => {}
            _ => {
                // unquoted token
                let mut s = String::from(c);
                while let Some(&n) = it.peek() {
                    if n.is_whitespace() || n == '{' || n == '}' || n == '"' {
                        break;
                    }
                    s.push(n);
                    it.next();
                }
                out.push(Tok::S(s));
            }
        }
    }
    out
}

fn parse_obj(t: &[Tok], i: &mut usize) -> Vec<(String, Vdf)> {
    let mut v = Vec::new();
    while *i < t.len() {
        match &t[*i] {
            Tok::Close => {
                *i += 1;
                return v;
            }
            Tok::Open => {
                *i += 1;
            }
            Tok::S(k) => {
                let key = k.clone();
                *i += 1;
                match t.get(*i) {
                    Some(Tok::S(val)) => {
                        v.push((key, Vdf::Str(val.clone())));
                        *i += 1;
                    }
                    Some(Tok::Open) => {
                        *i += 1;
                        let o = parse_obj(t, i);
                        v.push((key, Vdf::Obj(o)));
                    }
                    _ => {}
                }
            }
        }
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_nested_escaped_and_comments() {
        let src = "// comment\n\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"C:\\\\Program Files (x86)\\\\Steam\"\n\t\t\"apps\" { \"892970\" \"4542664874\" }\n\t}\n\tunquoted value\n}";
        let v = parse(src);
        let lf = v.get("LIBRARYFOLDERS").expect("case-insensitive");
        assert_eq!(lf.path(&["0"]).unwrap().str("path"), Some("C:\\Program Files (x86)\\Steam"));
        assert_eq!(lf.path(&["0", "apps"]).unwrap().num("892970"), 4542664874);
        assert_eq!(lf.str("unquoted"), Some("value"));
        assert_eq!(lf.num("missing"), 0);
    }
}

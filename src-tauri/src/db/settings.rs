//! App settings, stored as key/value rows. Only the settings in `Setting` can
//! be written, so the keys in the table are always known ones.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::DbError;

/// Which colour scheme the app uses.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ThemeChoice {
    /// Follow the operating system.
    #[default]
    System,
    Light,
    Dark,
}

/// Every setting, each at its default until written.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Settings {
    pub theme: ThemeChoice,
    /// Whether the first-time hint about sending a prompt has been shown.
    pub send_hint_seen: bool,
}

/// One setting and its new value, as the webview sends it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Setting {
    Theme(ThemeChoice),
    SendHintSeen(bool),
}

const THEME_KEY: &str = "theme";
const SEND_HINT_SEEN_KEY: &str = "send_hint_seen";

impl ThemeChoice {
    fn as_str(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::Light => "light",
            Self::Dark => "dark",
        }
    }

    fn parse(text: &str) -> Option<Self> {
        [Self::System, Self::Light, Self::Dark]
            .into_iter()
            .find(|choice| choice.as_str() == text)
    }
}

/// Reads the settings. A missing key, or a stored value that doesn't parse,
/// gives that setting's default.
pub fn get_settings(conn: &Connection) -> Result<Settings, DbError> {
    let mut settings = Settings::default();
    let rows = conn
        .prepare("SELECT key, value FROM settings")?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (key, value) in rows {
        match key.as_str() {
            THEME_KEY => {
                settings.theme = ThemeChoice::parse(&value).unwrap_or_default();
            }
            SEND_HINT_SEEN_KEY => {
                settings.send_hint_seen = value.parse().unwrap_or_default();
            }
            _ => {}
        }
    }
    Ok(settings)
}

/// Writes one setting, replacing its previous value.
pub fn set_setting(conn: &Connection, setting: &Setting) -> Result<(), DbError> {
    let (key, value) = match setting {
        Setting::Theme(choice) => (THEME_KEY, choice.as_str().to_owned()),
        Setting::SendHintSeen(seen) => (SEND_HINT_SEEN_KEY, seen.to_string()),
    };
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        [key, value.as_str()],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_support::migrated;

    #[test]
    fn settings_default_to_system_and_unseen() {
        let conn = migrated();

        assert_eq!(
            get_settings(&conn).unwrap(),
            Settings {
                theme: ThemeChoice::System,
                send_hint_seen: false
            }
        );
    }

    #[test]
    fn a_setting_round_trips() {
        let conn = migrated();

        set_setting(&conn, &Setting::Theme(ThemeChoice::Dark)).unwrap();
        set_setting(&conn, &Setting::SendHintSeen(true)).unwrap();

        assert_eq!(
            get_settings(&conn).unwrap(),
            Settings {
                theme: ThemeChoice::Dark,
                send_hint_seen: true
            }
        );
    }

    #[test]
    fn setting_twice_keeps_the_last_value() {
        let conn = migrated();

        set_setting(&conn, &Setting::Theme(ThemeChoice::Dark)).unwrap();
        set_setting(&conn, &Setting::Theme(ThemeChoice::Light)).unwrap();
        set_setting(&conn, &Setting::SendHintSeen(true)).unwrap();
        set_setting(&conn, &Setting::SendHintSeen(false)).unwrap();

        let settings = get_settings(&conn).unwrap();
        assert_eq!(settings.theme, ThemeChoice::Light);
        assert!(!settings.send_hint_seen);
        let rows: i64 = conn
            .query_row("SELECT count(*) FROM settings", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 2);
    }

    #[test]
    fn an_unknown_stored_value_falls_back_to_the_default() {
        let conn = migrated();
        conn.execute_batch(
            "INSERT INTO settings (key, value) VALUES ('theme', 'purple'), ('send_hint_seen', 'maybe')",
        )
        .unwrap();

        assert_eq!(get_settings(&conn).unwrap(), Settings::default());
    }

    #[test]
    fn the_webview_sends_a_setting_as_one_keyed_value() {
        let theme: Setting = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();
        let hint: Setting = serde_json::from_str(r#"{"sendHintSeen":true}"#).unwrap();

        assert_eq!(theme, Setting::Theme(ThemeChoice::Dark));
        assert_eq!(hint, Setting::SendHintSeen(true));
    }
}

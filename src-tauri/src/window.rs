//! Fits the main window to the screen it opens on. Its size in
//! `tauri.conf.json` shows the Builder's longest built-in form, CO-STAR's,
//! without scrolling; a smaller screen gets as much of that as it can hold.

use tauri::{LogicalSize, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow};

/// Room for a title bar, in logical pixels, where the frame can't be
/// measured: on Linux a window reports no frame until it is first shown.
const TITLE_BAR_ESTIMATE: f64 = 40.0;
/// Room for panels and docks, in logical pixels, where the usable area is
/// the whole screen on Linux: GTK can't see them on Wayland.
const PANEL_ESTIMATE: f64 = 64.0;

/// The size of the frame drawn around the window's content: measured where
/// the platform knows it before the window is shown, otherwise a title bar
/// of the estimated height.
fn frame(
    inner: PhysicalSize<u32>,
    outer: PhysicalSize<u32>,
    scale: f64,
    measurable: bool,
) -> PhysicalSize<u32> {
    if measurable {
        PhysicalSize::new(
            outer.width.saturating_sub(inner.width),
            outer.height.saturating_sub(inner.height),
        )
    } else {
        PhysicalSize::new(0, (TITLE_BAR_ESTIMATE * scale).round() as u32)
    }
}

/// The part of the screen a window can use: the work area, less some room
/// for panels when the work area may wrongly be the whole screen.
fn usable(
    work_area: PhysicalSize<u32>,
    screen: PhysicalSize<u32>,
    scale: f64,
    may_hide_panels: bool,
) -> PhysicalSize<u32> {
    if may_hide_panels && work_area == screen {
        let panels = (PANEL_ESTIMATE * scale).round() as u32;
        PhysicalSize::new(work_area.width, work_area.height.saturating_sub(panels))
    } else {
        work_area
    }
}

/// Where a window of `inner` content size, with a `frame` around it, goes
/// in a usable `area` at `origin`: as large as asked unless the area is
/// smaller, then centred in the area. Sizes and positions are physical
/// pixels.
fn fit(
    inner: PhysicalSize<u32>,
    frame: PhysicalSize<u32>,
    origin: PhysicalPosition<i32>,
    area: PhysicalSize<u32>,
) -> (PhysicalSize<u32>, PhysicalPosition<i32>) {
    let size = PhysicalSize::new(
        inner.width.min(area.width.saturating_sub(frame.width)),
        inner.height.min(area.height.saturating_sub(frame.height)),
    );
    let gap = |space: u32, used: u32| (space.saturating_sub(used) / 2) as i32;
    let position = PhysicalPosition::new(
        origin.x + gap(area.width, size.width + frame.width),
        origin.y + gap(area.height, size.height + frame.height),
    );
    (size, position)
}

/// The width of the narrowest and the height of the shortest of `areas`.
fn smallest(areas: impl IntoIterator<Item = LogicalSize<f64>>) -> Option<LogicalSize<f64>> {
    areas
        .into_iter()
        .reduce(|a, b| LogicalSize::new(a.width.min(b.width), a.height.min(b.height)))
}

/// The minimum size to use instead of `min` when the fitted `size` is
/// smaller, so the system doesn't raise the window back past the screen.
fn lowered_min(min: PhysicalSize<u32>, size: PhysicalSize<u32>) -> Option<PhysicalSize<u32>> {
    let lowered = PhysicalSize::new(min.width.min(size.width), min.height.min(size.height));
    (lowered != min).then_some(lowered)
}

/// The usable area to fit the window in, and where it starts, in the
/// window's physical pixels. The window's own screen where that can be told
/// while it is hidden. Otherwise, as on Wayland, where the compositor picks
/// the screen when the window is shown, the smallest of the screens.
fn screen_area<R: Runtime>(
    window: &WebviewWindow<R>,
    linux: bool,
) -> tauri::Result<Option<(PhysicalPosition<i32>, PhysicalSize<u32>)>> {
    let monitor = match window.current_monitor()? {
        Some(monitor) => Some(monitor),
        None => window.primary_monitor()?,
    };
    if let Some(monitor) = monitor {
        let work = monitor.work_area();
        let area = usable(work.size, *monitor.size(), monitor.scale_factor(), linux);
        return Ok(Some((work.position, area)));
    }
    let monitors = window.available_monitors()?;
    let area = smallest(monitors.iter().map(|monitor| {
        let scale = monitor.scale_factor();
        usable(monitor.work_area().size, *monitor.size(), scale, linux).to_logical(scale)
    }));
    let origin = monitors.first().map(|monitor| monitor.work_area().position);
    let scale = window.scale_factor()?;
    Ok(area
        .zip(origin)
        .map(|(area, origin)| (origin, area.to_physical(scale))))
}

/// The window's minimum size from `tauri.conf.json`, if it has one.
fn configured_min<R: Runtime>(window: &WebviewWindow<R>) -> Option<LogicalSize<f64>> {
    let config = window
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == window.label())?;
    Some(LogicalSize::new(config.min_width?, config.min_height?))
}

/// Shrinks `window` to the usable area of its screen (the screen less the
/// taskbar or dock) when its configured size doesn't fit there, and centres
/// it in that area. On a screen smaller than the window's minimum size the
/// minimum is lowered to fit. Called before the window is first shown.
/// Wayland ignores the position, and places the window itself.
pub fn fit_to_screen<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    let linux = cfg!(target_os = "linux");
    let Some((origin, area)) = screen_area(window, linux)? else {
        log::warn!("no screen found to fit the main window to");
        return Ok(());
    };
    let scale = window.scale_factor()?;
    let inner = window.inner_size()?;
    let frame = frame(inner, window.outer_size()?, scale, !linux);
    let (size, position) = fit(inner, frame, origin, area);
    if let Some(lowered) =
        configured_min(window).and_then(|min| lowered_min(min.to_physical(scale), size))
    {
        window.set_min_size(Some(lowered))?;
    }
    if size != inner {
        window.set_size(size)?;
    }
    window.set_position(position)
}

#[cfg(test)]
mod tests {
    use super::*;

    const INNER: PhysicalSize<u32> = PhysicalSize::new(1100, 1120);
    // A title bar 31 pixels high and an 8-pixel border at each side.
    const FRAME: PhysicalSize<u32> = PhysicalSize::new(16, 39);

    #[test]
    fn a_window_that_fits_keeps_its_size_and_is_centred() {
        let (size, position) = fit(
            INNER,
            FRAME,
            PhysicalPosition::new(0, 0),
            PhysicalSize::new(2560, 1392),
        );
        assert_eq!(size, INNER);
        assert_eq!(position, PhysicalPosition::new(722, 116));
    }

    #[test]
    fn a_window_too_tall_for_the_screen_shrinks_to_its_usable_height() {
        let (size, position) = fit(
            INNER,
            FRAME,
            PhysicalPosition::new(0, 0),
            PhysicalSize::new(1920, 1032),
        );
        assert_eq!(size, PhysicalSize::new(1100, 993));
        assert_eq!(position, PhysicalPosition::new(402, 0));
    }

    #[test]
    fn a_window_too_wide_and_tall_shrinks_both_ways() {
        let (size, position) = fit(
            INNER,
            FRAME,
            PhysicalPosition::new(0, 0),
            PhysicalSize::new(1024, 720),
        );
        assert_eq!(size, PhysicalSize::new(1008, 681));
        assert_eq!(position, PhysicalPosition::new(0, 0));
    }

    #[test]
    fn the_window_is_centred_in_the_usable_area_of_its_screen() {
        // A second screen to the left, with a taskbar along its top.
        let (_, position) = fit(
            INNER,
            FRAME,
            PhysicalPosition::new(-1920, 40),
            PhysicalSize::new(1920, 1040),
        );
        assert_eq!(position, PhysicalPosition::new(-1518, 40));
    }

    #[test]
    fn a_measured_frame_is_the_difference_between_outer_and_inner() {
        let outer = PhysicalSize::new(1116, 1159);
        assert_eq!(frame(INNER, outer, 1.0, true), FRAME);
    }

    #[test]
    fn an_unmeasured_frame_is_an_estimated_title_bar_at_the_screen_scale() {
        // What Linux reports for a hidden window is not its frame.
        let outer = PhysicalSize::new(0, 0);
        assert_eq!(frame(INNER, outer, 1.0, false), PhysicalSize::new(0, 40));
        assert_eq!(frame(INNER, outer, 1.5, false), PhysicalSize::new(0, 60));
    }

    #[test]
    fn a_whole_screen_work_area_keeps_room_for_panels_where_they_may_be_hidden() {
        let screen = PhysicalSize::new(1920, 1080);
        assert_eq!(
            usable(screen, screen, 1.0, true),
            PhysicalSize::new(1920, 1016)
        );
        assert_eq!(
            usable(screen, screen, 2.0, true),
            PhysicalSize::new(1920, 952)
        );
        // Elsewhere a whole-screen work area is real: the taskbar auto-hides.
        assert_eq!(usable(screen, screen, 1.0, false), screen);
    }

    #[test]
    fn a_work_area_that_leaves_out_panels_is_used_as_it_is() {
        let screen = PhysicalSize::new(1920, 1080);
        let work_area = PhysicalSize::new(1920, 1052);
        assert_eq!(usable(work_area, screen, 1.0, true), work_area);
    }

    #[test]
    fn the_smallest_area_takes_the_narrowest_width_and_the_shortest_height() {
        let areas = [
            LogicalSize::new(2560.0, 1376.0),
            LogicalSize::new(1920.0, 1016.0),
            LogicalSize::new(1080.0, 1856.0),
        ];
        assert_eq!(smallest(areas), Some(LogicalSize::new(1080.0, 1016.0)));
        assert_eq!(smallest([]), None);
    }

    #[test]
    fn the_minimum_size_is_lowered_only_where_the_fitted_size_is_below_it() {
        let min = PhysicalSize::new(1520, 1000);
        // 1920x1080 at 200%: the fitted window is shorter than the minimum.
        assert_eq!(
            lowered_min(min, PhysicalSize::new(1904, 906)),
            Some(PhysicalSize::new(1520, 906))
        );
        assert_eq!(lowered_min(min, PhysicalSize::new(2200, 2240)), None);
        assert_eq!(lowered_min(min, min), None);
    }

    #[test]
    fn on_a_wayland_1080p_screen_the_window_and_its_title_bar_fit_with_room_for_panels() {
        let screen = PhysicalSize::new(1920, 1080);
        let area = usable(screen, screen, 1.0, true);
        let frame = frame(INNER, PhysicalSize::new(0, 0), 1.0, false);
        let (size, position) = fit(INNER, frame, PhysicalPosition::new(0, 0), area);
        assert_eq!(size, PhysicalSize::new(1100, 976));
        assert_eq!(size.height + frame.height, 1016);
        assert_eq!(position, PhysicalPosition::new(410, 0));
    }
}

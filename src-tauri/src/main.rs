// Hide the console window on Windows release builds. (No-op on Linux.)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    lumenroom_lib::run();
}

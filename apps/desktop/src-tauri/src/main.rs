// Empêche l'ouverture d'une console supplémentaire sous Windows en release — NE PAS RETIRER.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    asas_voice_lib::run()
}

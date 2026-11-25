fn main() {
    let x = match Some(1) {
        Some(_) => {
            let y: i32 = "string"; // Type error
            true
        },
        None => true,
    };
}

from init.app_init import init_app


def main() -> None:
    app = init_app()
    app.run()


if __name__ == "__main__":
    main()

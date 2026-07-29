from gc_backend import create_app

app = create_app()

if __name__ == "__main__":
    # 127.0.0.1, pas 0.0.0.0 : GeoApp est un outil local mono-utilisateur, rien
    # ne justifie d'exposer le débogueur Werkzeug (debug=True) au réseau local.
    app.run(host="127.0.0.1", port=8000, debug=True, use_reloader=False)

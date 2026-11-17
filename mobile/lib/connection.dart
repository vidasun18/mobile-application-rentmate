import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'state.dart';
import 'strings.dart';
import 'ui.dart';

class ServerConnectionLink extends StatelessWidget {
  const ServerConnectionLink({super.key});
  @override
  Widget build(BuildContext context) {
    final api = context.watch<AppState>();
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(api.baseUrl, style: Theme.of(context).textTheme.bodySmall),
          OutlinedButton.icon(
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const ServerConnectionPage()),
            ),
            icon: const Icon(Icons.settings_ethernet),
            label: Text(tr('serverConnection')),
          ),
        ],
      ),
    );
  }
}

class ServerConnectionPage extends StatefulWidget {
  const ServerConnectionPage({super.key});
  @override
  State<ServerConnectionPage> createState() => _ServerConnectionPageState();
}

class _ServerConnectionPageState extends State<ServerConnectionPage> {
  final form = GlobalKey<FormState>();
  late final TextEditingController address;
  bool busy = false;
  bool connected = false;
  String? error;
  @override
  void initState() {
    super.initState();
    address = TextEditingController(text: context.read<AppState>().baseUrl);
  }

  @override
  void dispose() {
    address.dispose();
    super.dispose();
  }

  Future<void> check({bool save = false}) async {
    if (!form.currentState!.validate()) return;
    setState(() {
      busy = true;
      connected = false;
      error = null;
    });
    try {
      final api = context.read<AppState>();
      if (save) {
        await api.connectToServer(address.text);
        if (mounted) Navigator.pop(context);
      } else {
        await api.testServerConnection(address.text);
        if (mounted) setState(() => connected = true);
      }
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !busy,
    child: Scaffold(
      appBar: AppBar(title: Text(tr('serverConnection'))),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 650),
          child: Form(
            key: form,
            child: ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Text(tr('serverHelp')),
                const SizedBox(height: 20),
                TextFormField(
                  key: const ValueKey('server_address'),
                  controller: address,
                  enabled: !busy,
                  keyboardType: TextInputType.url,
                  autocorrect: false,
                  enableSuggestions: false,
                  decoration: InputDecoration(
                    labelText: tr('serverAddress'),
                    hintText: 'http://192.168.1.10:3000',
                  ),
                  validator: (value) {
                    try {
                      AppState.normalizeServerUrl(value ?? '');
                      return null;
                    } on ApiError catch (e) {
                      return e.message;
                    }
                  },
                  onChanged: (_) => setState(() {
                    connected = false;
                    error = null;
                  }),
                ),
                const SizedBox(height: 16),
                Text(tr('emulatorAddressHelp')),
                const SizedBox(height: 16),
                Text(tr('serverChangeHelp')),
                const SizedBox(height: 20),
                if (error != null)
                  Text(
                    error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                if (connected)
                  Text(
                    tr('serverConnected'),
                    style: const TextStyle(color: teal),
                  ),
                const SizedBox(height: 16),
                OutlinedButton.icon(
                  onPressed: busy ? null : () => check(),
                  icon: const Icon(Icons.wifi_find),
                  label: Text(tr('testConnection')),
                ),
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: busy ? null : () => check(save: true),
                  child: busy
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(tr('saveConnection')),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

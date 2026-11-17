import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'state.dart';
import 'strings.dart';

const teal = Color(0xFF0A7D86);
String money(dynamic minor) =>
    'LKR ${NumberFormat('#,##0.00').format((num.tryParse('$minor') ?? 0) / 100)}';
String date(dynamic raw) {
  final d = DateTime.tryParse('$raw');
  return d == null ? '' : DateFormat('d MMM y · h:mm a').format(d.toLocal());
}

class SectionCard extends StatelessWidget {
  final Widget child;
  const SectionCard({super.key, required this.child});
  @override
  Widget build(BuildContext context) => Card(
    child: Padding(padding: const EdgeInsets.all(18), child: child),
  );
}

class HeroPanel extends StatelessWidget {
  final String title;
  final String? subtitle;
  const HeroPanel(this.title, {super.key, this.subtitle});
  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(24),
    decoration: BoxDecoration(
      gradient: const LinearGradient(
        colors: [teal, Color(0xFF063D44)],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      ),
      borderRadius: BorderRadius.circular(24),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (subtitle != null)
          Text(subtitle!, style: const TextStyle(color: Colors.white70)),
        const SizedBox(height: 10),
        Text(
          title,
          style: Theme.of(context).textTheme.headlineSmall?.copyWith(
            color: Colors.white,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    ),
  );
}

class StatusChip extends StatelessWidget {
  final String status;
  const StatusChip(this.status, {super.key});
  @override
  Widget build(BuildContext context) {
    final color = ['APPROVED', 'COMPLETED', 'ACCEPTED'].contains(status)
        ? Colors.teal
        : ['REJECTED', 'SUSPENDED', 'CANCELLED', 'REMOVED'].contains(status)
        ? Colors.red
        : Colors.blue;
    return Chip(
      visualDensity: VisualDensity.compact,
      side: BorderSide.none,
      backgroundColor: color.withValues(alpha: .09),
      label: Text(
        tr(status),
        style: TextStyle(fontSize: 12, color: color.shade800),
      ),
    );
  }
}

class EmptyState extends StatelessWidget {
  final String message;
  const EmptyState(this.message, {super.key});
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 48, horizontal: 24),
    child: Column(
      children: [
        const Icon(Icons.explore_outlined, size: 48, color: teal),
        const SizedBox(height: 16),
        Text(tr('empty'), style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 8),
        Text(message, textAlign: TextAlign.center),
      ],
    ),
  );
}

class RemoteList extends StatefulWidget {
  final Future<List<Json>> Function() load;
  final Widget Function(Json, VoidCallback) item;
  final Widget? header;
  final Widget Function(List<Json>)? headerBuilder;
  final String? empty;
  const RemoteList({
    super.key,
    required this.load,
    required this.item,
    this.header,
    this.headerBuilder,
    this.empty,
  });
  @override
  State<RemoteList> createState() => _RemoteListState();
}

class _RemoteListState extends State<RemoteList> {
  late Future<List<Json>> future;
  @override
  void initState() {
    super.initState();
    future = widget.load();
  }

  void reload() {
    setState(() {
      future = widget.load();
    });
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<List<Json>>(
    future: future,
    builder: (context, snapshot) {
      if (snapshot.connectionState != ConnectionState.done) {
        return const Center(child: CircularProgressIndicator());
      }
      if (snapshot.hasError) {
        return Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('${snapshot.error}', textAlign: TextAlign.center),
                const SizedBox(height: 12),
                FilledButton.icon(
                  onPressed: reload,
                  icon: const Icon(Icons.refresh),
                  label: Text(tr('retry')),
                ),
              ],
            ),
          ),
        );
      }
      final rows = snapshot.data ?? [];
      return RefreshIndicator(
        onRefresh: () async {
          reload();
          await future;
        },
        child: ListView(
          padding: const EdgeInsets.all(16),
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            if (widget.header != null) widget.header!,
            if (widget.headerBuilder != null) widget.headerBuilder!(rows),
            if (rows.isEmpty) EmptyState(widget.empty ?? tr('empty')),
            for (final row in rows) widget.item(row, reload),
          ],
        ),
      );
    },
  );
}

class FieldSpec {
  final String key, label, type;
  final String initial;
  final bool optional;
  final Map<String, String>? options;
  const FieldSpec(
    this.key,
    this.label, {
    this.type = 'text',
    this.initial = '',
    this.optional = false,
    this.options,
  });
}

int parseMinor(String raw) {
  if (!RegExp(r'^\d+(\.\d{1,2})?$').hasMatch(raw)) {
    throw FormatException(tr('invalidNumber'));
  }
  final parts = raw.split('.');
  return int.parse(parts[0]) * 100 +
      int.parse(parts.length == 2 ? parts[1].padRight(2, '0') : '0');
}

Future<Json?> formPage(
  BuildContext context,
  String title,
  List<FieldSpec> fields, {
  Future<void> Function(Json)? submit,
  String? help,
  Widget? header,
}) => Navigator.of(context).push<Json>(
  MaterialPageRoute(
    builder: (_) => DataForm(
      title: title,
      fields: fields,
      submit: submit,
      help: help,
      header: header,
    ),
  ),
);

class DataForm extends StatefulWidget {
  final String title;
  final List<FieldSpec> fields;
  final Future<void> Function(Json)? submit;
  final String? help;
  final Widget? header;
  const DataForm({
    super.key,
    required this.title,
    required this.fields,
    this.submit,
    this.help,
    this.header,
  });
  @override
  State<DataForm> createState() => _DataFormState();
}

class _DataFormState extends State<DataForm> {
  final form = GlobalKey<FormState>();
  late Map<String, TextEditingController> controls;
  bool busy = false;
  String? error;
  @override
  void initState() {
    super.initState();
    controls = {
      for (final f in widget.fields)
        f.key: TextEditingController(text: f.initial),
    };
  }

  @override
  void dispose() {
    for (final c in controls.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> save() async {
    if (!form.currentState!.validate()) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final values = <String, dynamic>{};
      for (final f in widget.fields) {
        final value = controls[f.key]!.text.trim();
        if (f.optional && value.isEmpty) continue;
        values[f.key] = f.type == 'money'
            ? parseMinor(value)
            : f.type == 'integer'
            ? int.parse(value)
            : f.type == 'datetime'
            ? DateTime.parse(value).toUtc().toIso8601String()
            : value;
      }
      await widget.submit?.call(values);
      if (mounted) Navigator.pop(context, values);
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(widget.title)),
    body: Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 650),
        child: Form(
          key: form,
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              if (widget.header != null)
                IgnorePointer(ignoring: busy, child: widget.header!),
              if (widget.help != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 20),
                  child: Text(widget.help!),
                ),
              for (final f in widget.fields)
                Padding(
                  padding: const EdgeInsets.only(bottom: 18),
                  child: f.options != null
                      ? DropdownButtonFormField<String>(
                          key: ValueKey('field_${f.key}'),
                          initialValue: controls[f.key]!.text.isEmpty
                              ? null
                              : controls[f.key]!.text,
                          decoration: InputDecoration(labelText: tr(f.label)),
                          items: f.options!.entries
                              .map(
                                (e) => DropdownMenuItem(
                                  value: e.key,
                                  child: Text(tr(e.value)),
                                ),
                              )
                              .toList(),
                          onChanged: busy
                              ? null
                              : (v) => controls[f.key]!.text = v ?? '',
                          validator: (v) => v == null ? tr('required') : null,
                        )
                      : TextFormField(
                          key: ValueKey('field_${f.key}'),
                          controller: controls[f.key],
                          enabled: !busy,
                          obscureText: f.type == 'password',
                          maxLines: f.type == 'multiline' ? 3 : 1,
                          readOnly: f.type == 'datetime',
                          onTap: f.type != 'datetime'
                              ? null
                              : () async {
                                  final initial =
                                      DateTime.tryParse(
                                        controls[f.key]!.text,
                                      ) ??
                                      DateTime.now().add(
                                        const Duration(days: 1),
                                      );
                                  final d = await showDatePicker(
                                    context: context,
                                    initialDate: initial,
                                    firstDate: DateTime.now().subtract(
                                      const Duration(days: 1),
                                    ),
                                    lastDate: DateTime.now().add(
                                      const Duration(days: 730),
                                    ),
                                  );
                                  if (d == null || !context.mounted) return;
                                  final t = await showTimePicker(
                                    context: context,
                                    initialTime: TimeOfDay.fromDateTime(
                                      initial,
                                    ),
                                  );
                                  if (t != null) {
                                    controls[f.key]!.text = DateTime(
                                      d.year,
                                      d.month,
                                      d.day,
                                      t.hour,
                                      t.minute,
                                    ).toIso8601String();
                                  }
                                },
                          keyboardType: f.type == 'money'
                              ? const TextInputType.numberWithOptions(
                                  decimal: true,
                                )
                              : f.type == 'integer'
                              ? TextInputType.number
                              : f.type == 'email'
                              ? TextInputType.emailAddress
                              : TextInputType.text,
                          decoration: InputDecoration(
                            labelText: tr(f.label),
                            suffixIcon: f.type == 'datetime'
                                ? const Icon(Icons.calendar_month_outlined)
                                : null,
                          ),
                          validator: (v) {
                            final s = (v ?? '').trim();
                            if (s.isEmpty) {
                              return f.optional ? null : tr('required');
                            }
                            if (f.type == 'money') {
                              try {
                                parseMinor(s);
                              } catch (_) {
                                return tr('invalidNumber');
                              }
                            }
                            if (f.type == 'integer' &&
                                (int.tryParse(s) == null || int.parse(s) < 1)) {
                              return tr('invalidInteger');
                            }
                            if (f.type == 'email' &&
                                !RegExp(
                                  r'^[^@\s]+@[^@\s]+\.[^@\s]+$',
                                ).hasMatch(s)) {
                              return tr('invalidEmail');
                            }
                            if (f.type == 'password' &&
                                (s.length < 12 || s.length > 72)) {
                              return tr('invalidPassword');
                            }
                            if (f.type == 'datetime' &&
                                DateTime.tryParse(s) == null) {
                              return tr('invalidDate');
                            }
                            return null;
                          },
                        ),
                ),
              if (error != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: Text(
                    error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
              FilledButton(
                onPressed: busy ? null : save,
                child: busy
                    ? const SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(widget.title),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

Future<bool> act(
  BuildContext context,
  Future<dynamic> Function() action,
) async {
  try {
    await action();
    if (context.mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(tr('saved'))));
    }
    return true;
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
    return false;
  }
}

class PersonCard extends StatelessWidget {
  final Json person;
  const PersonCard(this.person, {super.key});
  @override
  Widget build(BuildContext context) {
    final vehicle = person['vehicle'];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            CircleAvatar(
              backgroundColor: teal.withValues(alpha: .1),
              backgroundImage: person['photo_url'] != null
                  ? NetworkImage(person['photo_url'])
                  : null,
              child: person['photo_url'] == null
                  ? Text((person['name'] as String? ?? '?').characters.first)
                  : null,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                person['name'] ?? '',
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            if (person['verified'] == true)
              const Icon(Icons.verified_outlined, color: teal, size: 22),
          ],
        ),
        const SizedBox(height: 12),
        Text(
          '★ ${person['rating'] ?? tr('newRating')} · ${person['completed_trips'] ?? 0} ${tr('trips')} · ${person['cancellations'] ?? 0} ${tr('cancellations')}',
        ),
        if (vehicle != null) ...[
          const SizedBox(height: 8),
          Text(
            '${vehicle['model']} · ${vehicle['registration']} · ${vehicle['seats']} ${tr('seats')}',
          ),
          if ((vehicle['photos'] as List? ?? []).isNotEmpty)
            SizedBox(
              height: 120,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: [
                  for (final p in vehicle['photos'])
                    Padding(
                      padding: const EdgeInsets.only(top: 12, right: 8),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(12),
                        child: Image.network(
                          p['url'],
                          width: 150,
                          fit: BoxFit.cover,
                          errorBuilder: (_, e, s) =>
                              Center(child: Text(tr('imageFailed'))),
                        ),
                      ),
                    ),
                ],
              ),
            ),
        ],
      ],
    );
  }
}

class OfflineBanner extends StatelessWidget {
  const OfflineBanner({super.key});
  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    if (!state.offline) return const SizedBox.shrink();
    return Container(
      width: double.infinity,
      color: const Color(0xFFFFF2CE),
      padding: const EdgeInsets.all(12),
      child: Text(
        '${tr('offline')}${state.lastUpdated == null ? '' : '\n${tr('updated')}: ${date(state.lastUpdated)}'}',
      ),
    );
  }
}

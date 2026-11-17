import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'state.dart';
import 'strings.dart';
import 'ui.dart';
import 'profile.dart' show reasonForm;
import 'trip_actions.dart';

class TourPage extends StatefulWidget {
  final String id;
  const TourPage({super.key, required this.id});
  @override
  State<TourPage> createState() => _TourPageState();
}

class _TourPageState extends State<TourPage> {
  late Future<Json> future;
  bool busy = false;
  AppState get api => context.read<AppState>();
  @override
  void initState() {
    super.initState();
    future = load();
  }

  Future<Json> load() async =>
      Map<String, dynamic>.from(await api.request('/tours/${widget.id}'));
  void reload() {
    if (mounted) {
      setState(() {
        future = load();
      });
    }
  }

  Future<void> action(String path, {Json? body, Json? headers}) async {
    if (busy) return;
    setState(() => busy = true);
    final success = await act(
      context,
      () => api.request(
        '/tours/${widget.id}/$path',
        method: 'POST',
        body: body ?? {},
        headers: headers,
      ),
    );
    if (mounted) {
      setState(() => busy = false);
      if (success) reload();
    }
  }

  Future<void> withReason(String path, String title) async {
    final b = await reasonForm(context, title: title);
    if (b != null) await action(path, body: b);
  }

  Future<void> edit(
    String path,
    String title,
    List<FieldSpec> fields, {
    String? help,
  }) async {
    final b = await formPage(
      context,
      tr(title),
      fields,
      help: help,
      submit: (b) async {
        await api.request('/tours/${widget.id}/$path', method: 'POST', body: b);
      },
    );
    if (b != null) reload();
  }

  Widget button(String title, VoidCallback onTap, {bool secondary = false}) =>
      Padding(
        padding: const EdgeInsets.only(top: 10),
        child: SizedBox(
          width: double.infinity,
          child: secondary
              ? OutlinedButton(
                  onPressed: busy || api.offline ? null : onTap,
                  child: Text(tr(title)),
                )
              : FilledButton(
                  onPressed: busy || api.offline ? null : onTap,
                  child: Text(tr(title)),
                ),
        ),
      );
  Future<void> rate(Json t, String target, String title) async {
    await formPage(
      context,
      tr(title),
      [
        const FieldSpec(
          'score',
          'score',
          initial: '5',
          options: {'1': '1', '2': '2', '3': '3', '4': '4', '5': '5'},
        ),
        const FieldSpec(
          'comment',
          'comment',
          optional: true,
          type: 'multiline',
        ),
      ],
      submit: (b) async {
        await api.request(
          '/tours/${widget.id}/rating',
          method: 'POST',
          body: {...b, 'target_id': target, 'score': int.parse(b['score'])},
        );
      },
    );
    reload();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(tr(api.role == 'DRIVER' ? 'driverCard' : 'tours')),
      actions: [
        IconButton(
          tooltip: tr('refresh'),
          onPressed: reload,
          icon: const Icon(Icons.refresh),
        ),
      ],
    ),
    body: FutureBuilder<Json>(
      future: future,
      builder: (context, s) {
        if (s.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        if (s.hasError) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('${s.error}'),
                  OutlinedButton(onPressed: reload, child: Text(tr('retry'))),
                ],
              ),
            ),
          );
        }
        final t = s.data!;
        final status = t['status'];
        final quote = t['quote'];
        final a = t['assignment'];
        return Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 750),
            child: ListView(
              padding: const EdgeInsets.all(18),
              children: [
                const OfflineBanner(),
                HeroPanel(
                  '${t['pickup']} → ${t['destination']}',
                  subtitle: date(t['starts_at']),
                ),
                StatusChip(status),
                SectionCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${t['vehicle_type']} · ${t['passengers']} ${tr('passengers')}',
                      ),
                      Text('${tr('endsAt')}: ${date(t['ends_at'])}'),
                      if (t['notes'] != null && t['notes'] != '')
                        Text(t['notes']),
                    ],
                  ),
                ),
                if (quote != null)
                  SectionCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${tr('total')}: ${money(quote['total_minor'])}'),
                        Text(
                          '${tr('deposit')}: ${money(quote['deposit_minor'])}',
                        ),
                        const SizedBox(height: 8),
                        Text(quote['terms']),
                        Text(tr('moneyRecord')),
                      ],
                    ),
                  ),
                if (t['payout_minor'] != null)
                  SectionCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${tr('payout')}: ${money(t['payout_minor'])}',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        if (t['commission_minor'] != null)
                          Text(
                            '${tr('commission')}: ${money(t['commission_minor'])}',
                          ),
                        if (t['collection_minor'] != null)
                          Text(
                            '${tr('collection')}: ${money(t['collection_minor'])}',
                          ),
                        if (t['payable_to_agent_minor'] != null)
                          Text(
                            '${tr('payAgent')}: ${money(t['payable_to_agent_minor'])}',
                          ),
                        if (t['instructions'] != null) Text(t['instructions']),
                      ],
                    ),
                  ),
                if (t['tourist'] != null)
                  SectionCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(t['tourist']['name']),
                        Text(t['tourist']['phone']),
                      ],
                    ),
                  ),
                if (api.role == 'TOURIST') ...[
                  if (t['driver_card'] != null)
                    SectionCard(child: PersonCard(t['driver_card']))
                  else if (![
                    'REQUESTED',
                    'QUOTED',
                    'CANCELLED',
                  ].contains(status))
                    SectionCard(child: Text(tr('awaitDriver'))),
                  if (status == 'QUOTED') ...[
                    button(
                      'acceptQuote',
                      () => action('accept', body: {'accept': true}),
                    ),
                    button(
                      'declineQuote',
                      () => action('accept', body: {'accept': false}),
                      secondary: true,
                    ),
                  ],
                  if (['ACCEPTED', 'OPEN', 'ASSIGNED'].contains(status))
                    button(
                      'change',
                      () => edit('changes', 'change', [
                        const FieldSpec(
                          'request',
                          'changeRequest',
                          type: 'multiline',
                        ),
                      ]),
                      secondary: true,
                    ),
                  if (status == 'COMPLETED') ...[
                    button(
                      'rateAgent',
                      () => rate(t, t['agent_id'], 'rateAgent'),
                    ),
                    if (t['driver_card'] != null)
                      button(
                        'rateDriver',
                        () => rate(t, t['driver_card']['id'], 'rateDriver'),
                      ),
                  ],
                ],
                if (api.role == 'AGENT') ...[
                  if (quote != null &&
                      [
                        'ACCEPTED',
                        'OPEN',
                        'ASSIGNED',
                        'IN_PROGRESS',
                        'COMPLETED',
                      ].contains(status))
                    button(
                      t['deposit_received'] == true
                          ? 'depositReceived'
                          : 'markDeposit',
                      () => action(
                        'deposit',
                        body: {'accept': t['deposit_received'] != true},
                      ),
                      secondary: true,
                    ),
                  if (['REQUESTED', 'QUOTED'].contains(status))
                    button(
                      'quote',
                      () => edit('quote', 'quote', [
                        const FieldSpec('total_minor', 'total', type: 'money'),
                        const FieldSpec(
                          'deposit_minor',
                          'deposit',
                          type: 'money',
                        ),
                        const FieldSpec('terms', 'terms', type: 'multiline'),
                      ]),
                    ),
                  if (status == 'ACCEPTED')
                    button(
                      'post',
                      () => edit(
                        'post',
                        'post',
                        [
                          const FieldSpec(
                            'payout_minor',
                            'payout',
                            type: 'money',
                          ),
                          const FieldSpec(
                            'collector',
                            'collector',
                            initial: 'AGENT',
                            options: {
                              'AGENT': 'agentCollects',
                              'DRIVER': 'driverCollects',
                            },
                          ),
                          const FieldSpec(
                            'collection_minor',
                            'collection',
                            type: 'money',
                          ),
                          const FieldSpec(
                            'instructions',
                            'instructions',
                            type: 'multiline',
                            optional: true,
                          ),
                        ],
                        help:
                            '${t['pickup']} → ${t['destination']}\n${date(t['starts_at'])} · ${t['vehicle_type']} · ${t['passengers']} ${tr('passengers')}\n${tr('total')}: ${money(quote['total_minor'])}\n${tr('deposit')}: ${money(quote['deposit_minor'])}\n${tr('moneyRecord')}',
                      ),
                    ),
                  if (status == 'OPEN')
                    button('selectDriver', () async {
                      await Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => DriverSelection(id: widget.id),
                        ),
                      );
                      reload();
                    }),
                  if (a != null) ...[
                    SectionCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          PersonCard(a['card']),
                          Text(a['phone'] ?? ''),
                          if (a['withdrawal_reason'] != null)
                            Text(
                              a['withdrawal_reason'],
                              style: const TextStyle(color: Colors.red),
                            ),
                        ],
                      ),
                    ),
                    if (status == 'ASSIGNED' &&
                        a['sent_at'] == null &&
                        a['withdrawal_reason'] == null)
                      button('confirmSend', () async {
                        await Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => SendPage(id: widget.id),
                          ),
                        );
                        reload();
                      }),
                    if (a['sent_at'] != null)
                      SectionCard(
                        child: Text('${tr('sent')}: ${date(a['sent_at'])}'),
                      ),
                    if (a['release_phone'] == true &&
                        ['ASSIGNED', 'IN_PROGRESS'].contains(status))
                      button(
                        'revokeContact',
                        () => action('contact', body: {'release_phone': false}),
                        secondary: true,
                      ),
                    if (status == 'ASSIGNED')
                      button(
                        'reopen',
                        () => withReason('reopen', 'reopen'),
                        secondary: true,
                      ),
                    if (status == 'COMPLETED')
                      button(
                        'rateDriver',
                        () => rate(t, a['driver_id'], 'rateDriver'),
                      ),
                  ],
                ],
                if (api.role == 'DRIVER') ...[
                  if (status == 'OPEN') InterestButton(tour: t, reload: reload),
                  if (t['is_taken'] == true && t['is_assigned'] != true)
                    SectionCard(child: Text(tr('taken'))),
                  if (t['is_assigned'] == true) ...[
                    if (t['sent_at'] == null)
                      SectionCard(child: Text(tr('awaitSend')))
                    else ...[
                      SectionCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '${tr('firstName')}: ${t['tourist_first_name']}',
                            ),
                            if (t['tourist_phone'] != null)
                              Text(
                                '${tr('touristPhone')}: ${t['tourist_phone']}',
                              )
                            else
                              Text(tr('phoneHidden')),
                          ],
                        ),
                      ),
                      if (status == 'ASSIGNED' &&
                          t['withdrawal_reason'] == null) ...[
                        if (t['acknowledged_at'] == null)
                          button('acknowledge', () => action('acknowledge'))
                        else
                          button(
                            'start',
                            () => action(
                              'status',
                              body: {'status': 'IN_PROGRESS'},
                            ),
                          ),
                      ],
                      if (status == 'IN_PROGRESS')
                        button(
                          'complete',
                          () => action('status', body: {'status': 'COMPLETED'}),
                        ),
                    ],
                    if (status == 'ASSIGNED' && t['withdrawal_reason'] == null)
                      button(
                        'withdraw',
                        () => withReason('withdraw', 'withdraw'),
                        secondary: true,
                      ),
                  ],
                ],
                for (final c in (t['changes'] as List? ?? []))
                  SectionCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          tr('changeRequest'),
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        Text(c['request']),
                        StatusChip(c['status']),
                        if (c['response'] != null) Text(c['response']),
                        if (api.role == 'AGENT' &&
                            c['status'] == 'PENDING' &&
                            ['ACCEPTED', 'OPEN', 'ASSIGNED'].contains(status))
                          Wrap(
                            spacing: 8,
                            children: [
                              OutlinedButton(
                                onPressed: () async {
                                  final b = await formPage(
                                    context,
                                    tr('approve'),
                                    [
                                      const FieldSpec('response', 'response'),
                                      FieldSpec(
                                        'pickup',
                                        'from',
                                        initial: t['pickup'],
                                      ),
                                      FieldSpec(
                                        'starts_at',
                                        'startsAt',
                                        type: 'datetime',
                                        initial: t['starts_at'],
                                      ),
                                      FieldSpec(
                                        'ends_at',
                                        'endsAt',
                                        type: 'datetime',
                                        initial: t['ends_at'],
                                      ),
                                    ],
                                    submit: (b) async {
                                      await api.request(
                                        '/tours/${widget.id}/changes/${c['id']}/review',
                                        method: 'POST',
                                        body: {...b, 'accept': true},
                                      );
                                    },
                                  );
                                  if (b != null) reload();
                                },
                                child: Text(tr('approve')),
                              ),
                              OutlinedButton(
                                onPressed: () => action(
                                  'changes/${c['id']}/review',
                                  body: {
                                    'accept': false,
                                    'response': tr('reject'),
                                  },
                                ),
                                child: Text(tr('reject')),
                              ),
                            ],
                          ),
                      ],
                    ),
                  ),
                if (status == 'COMPLETED' &&
                    ['AGENT', 'DRIVER'].contains(api.role)) ...[
                  if (t['settlement'] == null && api.role == 'AGENT')
                    button(
                      'recordSettlement',
                      () => edit('settlement', 'recordSettlement', [
                        const FieldSpec(
                          'amount_minor',
                          'amount',
                          type: 'money',
                        ),
                        const FieldSpec(
                          'note',
                          'settlementNote',
                          optional: true,
                          type: 'multiline',
                        ),
                      ]),
                    ),
                  if (t['settlement'] != null)
                    SectionCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            tr('settlement'),
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          Text(money(t['settlement']['amount_minor'])),
                          Text(t['settlement']['note']),
                          for (final event
                              in (t['settlement']['history'] as List? ?? []))
                            Text(
                              '${tr(event['action'])} · ${date(event['created_at'])}',
                            ),
                          Text(
                            '${tr('agentConfirmed')}: ${t['settlement']['agent_confirmed_at'] != null ? '✓' : '—'}',
                          ),
                          Text(
                            '${tr('driverConfirmed')}: ${t['settlement']['driver_confirmed_at'] != null ? '✓' : '—'}',
                          ),
                          button(
                            'confirmSettlement',
                            () => action('settlement/confirm'),
                          ),
                        ],
                      ),
                    ),
                ],
                if (['TOURIST', 'AGENT'].contains(api.role) &&
                    [
                      'REQUESTED',
                      'QUOTED',
                      'ACCEPTED',
                      'OPEN',
                      'ASSIGNED',
                    ].contains(status))
                  button(
                    'cancelTour',
                    () => withReason('cancel', 'cancelTour'),
                    secondary: true,
                  ),
                const SizedBox(height: 24),
              ],
            ),
          ),
        );
      },
    ),
  );
}

class DriverSelection extends StatelessWidget {
  final String id;
  const DriverSelection({super.key, required this.id});
  @override
  Widget build(BuildContext context) {
    final api = context.read<AppState>();
    return Scaffold(
      appBar: AppBar(title: Text(tr('selectDriver'))),
      body: RemoteList(
        load: () async =>
            (await api.request('/tours/$id/interests') as List).cast<Json>(),
        empty: tr('noDrivers'),
        item: (a, reload) => SectionCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              PersonCard(a['card']),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () async {
                  if (await act(
                        context,
                        () => api.request(
                          '/tours/$id/assign',
                          method: 'POST',
                          body: {'driver_id': a['driver_id']},
                        ),
                      ) &&
                      context.mounted) {
                    Navigator.pop(context);
                  }
                },
                child: Text(tr('select')),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class SendPage extends StatefulWidget {
  final String id;
  const SendPage({super.key, required this.id});
  @override
  State<SendPage> createState() => _SendPageState();
}

class _SendPageState extends State<SendPage> {
  bool release = false, busy = false;
  late Future<Json> future;
  final keyValue = 'send_${DateTime.now().microsecondsSinceEpoch}';
  @override
  void initState() {
    super.initState();
    future = (() async => Map<String, dynamic>.from(
      await context.read<AppState>().request('/tours/${widget.id}/preview'),
    ))();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(tr('confirmSend'))),
    body: FutureBuilder<Json>(
      future: future,
      builder: (context, s) {
        if (!s.hasData) {
          return Center(
            child: s.hasError
                ? Text('${s.error}')
                : const CircularProgressIndicator(),
          );
        }
        final p = s.data!;
        final d = p['driver_card'];
        return Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 750),
            child: ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Text(
                  tr('touristCard'),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                SectionCard(child: PersonCard(p['tourist_card'])),
                const SizedBox(height: 16),
                Text(
                  tr('driverCard'),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                SectionCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${d['pickup']} → ${d['destination']}'),
                      Text(date(d['starts_at'])),
                      Text('${d['passengers']} ${tr('passengers')}'),
                      Text('${tr('payout')}: ${money(d['payout_minor'])}'),
                      Text('${tr('firstName')}: ${d['tourist_first_name']}'),
                      if (release)
                        Text(
                          '${tr('touristPhone')}: ${d['phone_if_authorized']}',
                        ),
                      Text(d['instructions']),
                      if (d['collection_minor'] != null)
                        Text(
                          '${tr('collection')}: ${money(d['collection_minor'])}',
                        ),
                      if (d['payable_to_agent_minor'] != null)
                        Text(
                          '${tr('payAgent')}: ${money(d['payable_to_agent_minor'])}',
                        ),
                    ],
                  ),
                ),
                SwitchListTile.adaptive(
                  title: Text(tr('sharePhone')),
                  subtitle: Text(tr('sharePhoneHelp')),
                  value: release,
                  onChanged: busy ? null : (v) => setState(() => release = v),
                ),
                if (p['money'] != null)
                  SectionCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          tr('moneySummary'),
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        Text(
                          '${tr('total')}: ${money(p['money']['total_minor'])}',
                        ),
                        Text(
                          '${tr('deposit')}: ${money(p['money']['deposit_minor'])}',
                        ),
                        Text(
                          '${tr('payout')}: ${money(p['money']['payout_minor'])}',
                        ),
                        Text(
                          '${tr('commission')}: ${money(p['money']['commission_minor'])}',
                        ),
                        Text(
                          tr(
                            p['money']['collector'] == 'DRIVER'
                                ? 'driverCollects'
                                : 'agentCollects',
                          ),
                        ),
                        Text(
                          '${tr('collection')}: ${money(p['money']['collection_minor'])}',
                        ),
                      ],
                    ),
                  ),
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: busy
                      ? null
                      : () async {
                          setState(() => busy = true);
                          final api = context.read<AppState>();
                          final success = await act(
                            context,
                            () => api.request(
                              '/tours/${widget.id}/send',
                              method: 'POST',
                              body: {'release_phone': release},
                              headers: {'Idempotency-Key': keyValue},
                            ),
                          );
                          if (!context.mounted) return;
                          if (success) {
                            Navigator.pop(context);
                          } else {
                            setState(() => busy = false);
                          }
                        },
                  child: Text(tr('confirmSend')),
                ),
              ],
            ),
          ),
        );
      },
    ),
  );
}

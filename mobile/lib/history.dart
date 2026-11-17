import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'state.dart';
import 'strings.dart';
import 'ui.dart';

class HistoryPage extends StatelessWidget {
  const HistoryPage({super.key});
  @override
  Widget build(BuildContext context) {
    final api = context.read<AppState>();
    return Scaffold(
      appBar: AppBar(title: Text(tr('tripHistory'))),
      body: RemoteList(
        load: () async =>
            (await api.request('/me/history') as List).cast<Json>(),
        empty: tr('emptyTours'),
        item: (t, reload) => SectionCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                t['pickup'] == null
                    ? tr('archivedTrip')
                    : '${t['pickup']} → ${t['destination']}',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              Text(date(t['starts_at'])),
              StatusChip(t['outcome']),
              if (t['vehicle_type'] != null)
                Text(
                  '${t['vehicle_type']} · ${t['passengers']} ${tr('passengers')}',
                ),
              if (t['withdrawal_reason'] != null)
                Text(t['withdrawal_reason'])
              else if (t['end_reason'] != null)
                Text(t['end_reason']),
            ],
          ),
        ),
      ),
    );
  }
}
